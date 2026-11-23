"""Find text in notes that tries to instruct an automated reviewer.

Clinical notes are written for people. Text that addresses an AI, claims a role ("[system]"),
or tells the reader to ignore rules or approve is suspicious wherever it appears. A hit does not
change any finding; it sends the case to a person, who sees the highlighted text.
"""

import re
from dataclasses import dataclass

_PATTERNS = [
    r"\b(?:ignore|disregard|forget|override)\b[^.\n]{0,60}\b(?:instructions?|polic(?:y|ies)|rules?|criteria|guidelines?)\b",
    r"\b(?:previous|prior|above|earlier|all)\s+instructions\b",
    r"\b(?:automated|ai|artificial[- ]intelligence|llm)\s+"
    r"(?:reviewer|review|system|assistant|model|agent)\b",
    r"\breviewer\s+(?:model|bot|system)\b",
    r"\byou\s+are\s+(?:now\s+)?(?:an?\s+)?(?:ai|assistant|language\s+model|chatbot|llm)\b",
    r"\[\s*/?\s*(?:system|assistant|inst|user)\s*\]",
    r"(?m)^\s*(?:system|assistant)\s*:",
    r"<\|?\s*(?:im_start|im_end|system|endoftext)\s*\|?>",
    r"\b(?:mark|output|return|answer|respond|recommend)\b[^.\n]{0,50}\b(?:meets_criteria|approv(?:e|al|ed)|all\s+criteria|every\s+criterion)\b",
    r"\bpre-?approved\b",
    r"\bconfidence\s+(?:of\s+)?1(?:\.0+)?\b",
]
_DETECT = [re.compile(p, re.IGNORECASE) for p in _PATTERNS]


@dataclass(frozen=True)
class Hit:
    doc_id: str
    start: int
    end: int
    text: str


def scan(documents: dict[str, str]) -> list[Hit]:
    """Every line with suspicious text, by document, in reading order. A reviewer reads the whole
    line once, not each matched fragment of it."""
    hits = []
    for doc_id, text in documents.items():
        lines: set[tuple[int, int]] = set()
        for pattern in _DETECT:
            for match in pattern.finditer(text):
                start = text.rfind("\n", 0, match.start()) + 1
                end = text.find("\n", match.end())
                end = len(text) if end < 0 else end
                line = text[start:end]
                start += len(line) - len(line.lstrip())  # the span covers the text, not padding
                end -= len(line) - len(line.rstrip())
                lines.add((start, end))
        hits += [Hit(doc_id, s, e, text[s:e]) for s, e in sorted(lines)]
    return hits
