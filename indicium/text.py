"""Text helpers shared by policies and reviews: HTML to text, and finding a quote in a source.

`locate` is what makes "no invented evidence" hold: a quote counts only if it is found in the
source after normalizing case, whitespace, quote marks and dashes. Nothing else is forgiven.
"""

import re
import unicodedata
from html.parser import HTMLParser

# Typographic quote marks and dashes fold to their ASCII forms; a soft hyphen disappears.
_FOLD = str.maketrans(
    dict.fromkeys(map(chr, (0x2018, 0x2019, 0x201A, 0x201B)), "'")
    | dict.fromkeys(map(chr, (0x201C, 0x201D, 0x201E)), '"')
    | dict.fromkeys(map(chr, (0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2212)), "-")
    | {chr(0xAD): ""}
)
# Characters a model often wraps a quote in or ends it with; they are not part of the evidence.
_EDGES = " \"'.,;:!?()[]-"


def normalize(text: str) -> tuple[str, list[int]]:
    """Folded text, and for each of its characters the index of the source character."""
    out: list[str] = []
    index: list[int] = []
    space = True  # drops leading whitespace and collapses runs
    for i, raw in enumerate(text):
        for ch in unicodedata.normalize("NFKC", raw).translate(_FOLD).casefold():
            if ch.isspace():
                if space:
                    continue
                ch, space = " ", True
            else:
                space = False
            out.append(ch)
            index.append(i)
    if out and out[-1] == " ":
        out.pop()
        index.pop()
    return "".join(out), index


def locate(quote: str, source: str) -> tuple[int, int] | None:
    """The [start, end) span of `quote` in `source`, or None when it is not there."""
    folded = normalize(quote)[0].strip(_EDGES)
    if not folded:
        return None
    text, index = normalize(source)
    at = text.find(folded)
    if at < 0:
        return None
    return index[at], index[at + len(folded) - 1] + 1


class _TextOf(HTMLParser):
    BLOCKS = frozenset(
        {"p", "div", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "table"}
        | {"blockquote", "section", "article"}
    )

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in self.BLOCKS:
            self.parts.append("\n")
        if tag == "br":
            self.parts.append("\n")
        elif tag == "li":
            self.parts.append("- ")
        elif tag in ("td", "th"):
            self.parts.append(" | ")

    def handle_endtag(self, tag: str) -> None:
        if tag in self.BLOCKS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def html_to_text(html: str) -> str:
    """Readable plain text: one line per paragraph or list item, list items start with "- "."""
    parser = _TextOf()
    parser.feed(html or "")
    parser.close()
    # \s also matches the non-breaking spaces policy HTML is full of.
    lines = (re.sub(r"\s+", " ", line).strip() for line in "".join(parser.parts).splitlines())
    return join_orphan_markers(re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip())


def join_orphan_markers(text: str) -> str:
    """A list item whose content sits in its own paragraph leaves a lone "-" line; join it to the
    text it marks ("-" then "The LCD ..." becomes "- The LCD ...")."""
    return re.sub(r"(?m)^-[ \t]*\n+(?=\S)", "- ", text)
