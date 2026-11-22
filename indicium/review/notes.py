"""Clinical notes as sentences with exact character offsets, for retrieval and highlighting."""

import re
from dataclasses import dataclass

# A sentence ends at a line break, or at . ! ? ; followed by space and a capital, digit or bracket.
_BOUNDARY = re.compile(r"\n+|(?<=[.!?;])\s+(?=[A-Z0-9(\[\"'])")
# ...but not after a title, a common abbreviation or a single initial ("Dr. N. Abernathy").
_NOT_AN_END = re.compile(r"(?:\b(?:Dr|Mr|Mrs|Ms|St|vs|No|approx|e\.g|i\.e)|\b[A-Z])\.$")


@dataclass(frozen=True)
class Sentence:
    doc_id: str
    start: int
    end: int
    text: str


def sentences(doc_id: str, text: str) -> list[Sentence]:
    found: list[Sentence] = []
    start = 0
    for boundary in _BOUNDARY.finditer(text):
        if not boundary.group().startswith("\n") and _NOT_AN_END.search(text[: boundary.start()]):
            continue
        _add(found, doc_id, text, start, boundary.start())
        start = boundary.end()
    _add(found, doc_id, text, start, len(text))
    return found


def _add(found: list[Sentence], doc_id: str, text: str, start: int, end: int) -> None:
    piece = text[start:end]
    stripped = piece.strip()
    if stripped:
        offset = start + len(piece) - len(piece.lstrip())
        found.append(Sentence(doc_id, offset, offset + len(stripped), stripped))
