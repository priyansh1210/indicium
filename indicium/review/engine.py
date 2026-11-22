"""One review: a request, its policy and a provider in; verified findings and a decision out.

No database and no clock here, so every guarantee can be tested directly. The worker
(worker.py) handles queueing, storage and audit around it.
"""

import hashlib
import json
import time
from dataclasses import dataclass, field

from indicium.cases.model import CaseRequest
from indicium.policies.model import Policy, criteria_of
from indicium.review import injection
from indicium.review.privacy import mask
from indicium.review.providers import Document, ExtractionTask, Provider, ProviderResult
from indicium.review.rules import Decision, diagnosis_covered, recommend
from indicium.review.verify import CheckedFinding, MaskedDocument, statuses, verify


@dataclass
class ReviewOutcome:
    decision: Decision
    findings: list[CheckedFinding]
    flags: set[str]
    injection_hits: list[injection.Hit]
    result: ProviderResult | None  # None when there was nothing to read
    input_hash: str
    timings_ms: dict[str, int] = field(default_factory=dict)


def review(
    request: CaseRequest, policy: Policy, provider: Provider, min_confidence: float
) -> ReviewOutcome:
    timings: dict[str, int] = {}
    clock = time.perf_counter()

    masked = {}
    for d in request.documents:
        text, index = mask(d.text, request.patient)
        masked[d.doc_id] = MaskedDocument(d.text, text, index)
    hits = injection.scan({d.doc_id: d.text for d in request.documents})
    flags = {"possible_injection"} if hits else set()
    if not diagnosis_covered(policy, request.diagnosis_codes):
        flags.add("diagnosis_not_covered")
    task = ExtractionTask(
        policy=policy,
        service=request.procedure_code,
        documents=[
            Document(d.doc_id, d.kind, str(d.written_on or ""), d.author, masked[d.doc_id].masked)
            for d in request.documents
        ],
    )
    input_hash = hashlib.sha256(
        json.dumps(
            [policy.model_dump(mode="json"), [vars(d) for d in task.documents]], sort_keys=True
        ).encode()
    ).hexdigest()
    timings["prepare"] = _since(clock)

    if not request.documents:
        decision = recommend(policy, {}, flags, has_documents=False)
        empty = [
            CheckedFinding(c.id, "absent", 1.0, "No clinical documents were submitted.")
            for c in criteria_of(policy.criteria)
        ]  # the checklist still lists every criterion
        return ReviewOutcome(decision, empty, flags, hits, None, input_hash, timings)

    clock = time.perf_counter()
    result = provider.extract(task)
    timings["extract"] = _since(clock)

    clock = time.perf_counter()
    findings, found_flags = verify(result.extraction, policy, masked, min_confidence)
    flags |= found_flags
    decision = recommend(policy, statuses(findings), flags, has_documents=True)
    timings["verify"] = _since(clock)
    return ReviewOutcome(decision, findings, flags, hits, result, input_hash, timings)


def _since(start: float) -> int:
    return round((time.perf_counter() - start) * 1000)
