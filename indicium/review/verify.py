"""Check a provider's findings against the notes. Only what survives this reaches a nurse.

- Every quote must be found word for word in the document it names (see indicium.text.locate).
  Quotes that are not found, too short, or name a missing document are dropped and recorded.
- A finding other than "absent" with no surviving quote becomes "absent".
- A criterion the provider skipped counts as absent with confidence 0.
"""

from dataclasses import dataclass, field

from indicium.policies.model import Policy, criteria_of
from indicium.review.privacy import original_span
from indicium.review.providers import Extraction
from indicium.text import locate

MIN_QUOTE_CHARS = 8


@dataclass(frozen=True)
class MaskedDocument:
    original: str
    masked: str
    index: list[int]  # masked character -> original character


@dataclass
class CheckedFinding:
    criterion_id: str
    finding: str  # documented | contradicted | absent | conflicting
    confidence: float
    rationale: str
    evidence: list[dict] = field(default_factory=list)  # {doc_id, quote, start, end} in originals
    dropped: list[dict] = field(default_factory=list)  # {doc_id, quote, reason}


def verify(
    extraction: Extraction,
    policy: Policy,
    documents: dict[str, MaskedDocument],
    min_confidence: float,
) -> tuple[list[CheckedFinding], set[str]]:
    flags: set[str] = set()
    given: dict[str, object] = {}
    for f in extraction.findings:
        given.setdefault(f.criterion_id, f)  # the first finding per criterion counts

    checked = []
    for criterion in criteria_of(policy.criteria):
        f = given.get(criterion.id)
        if f is None:
            flags.add("low_confidence")
            checked.append(
                CheckedFinding(criterion.id, "absent", 0.0, "No finding was given for this item.")
            )
            continue
        evidence, dropped = [], []
        for q in f.evidence:
            doc = documents.get(q.doc_id)
            span = None
            if doc is None:
                reason = "names a document that is not in the case"
            elif len(q.quote.strip()) < MIN_QUOTE_CHARS:
                reason = "too short to be evidence"
            elif (span := locate(q.quote, doc.masked)) is None:
                reason = "not found word for word in the document"
            if span is None:
                dropped.append({"doc_id": q.doc_id, "quote": q.quote[:2000], "reason": reason})
                continue
            start, end = original_span(doc.index, *span)
            evidence.append(
                {"doc_id": q.doc_id, "quote": doc.original[start:end], "start": start, "end": end}
            )

        finding, rationale = f.finding, f.rationale.strip()
        if finding != "absent" and not evidence:
            finding = "absent"
            rationale = f"{rationale} No quote could be verified, so this counts as not documented."
        if finding == "conflicting":
            flags.add("conflicting_evidence")
        if f.confidence < min_confidence:
            flags.add("low_confidence")
        checked.append(
            CheckedFinding(
                criterion.id, finding, f.confidence, rationale.strip(), evidence, dropped
            )
        )
    if extraction.suspected_instructions:
        flags.add("possible_injection")
    return checked, flags


def statuses(checked: list[CheckedFinding]) -> dict[str, bool | None]:
    """Findings as the three values the policy tree is evaluated with."""
    value = {"documented": True, "contradicted": False}
    return {c.criterion_id: value.get(c.finding) for c in checked}
