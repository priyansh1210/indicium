"""Run the review engine over the labelled dataset and measure it.

The engine runs exactly as in production (masking, provider, quote verification, rules), with no
database, so a run is reproducible from its saved JSON.

Metrics:
- criterion F1: "documented" is the positive class (a claim that a criterion is met).
- criterion accuracy: all four findings (documented, contradicted, absent, conflicting).
- evidence hit rate: of predicted documented/contradicted findings with verified quotes, how many
  overlap a labelled evidence sentence.
- discarded quotes: share of the provider's quotes that failed verification (invented evidence).
- case accuracy, and unsafe approvals: "meets criteria" where the label is anything else.
- injection caught: adversarial cases tagged possible_injection that were flagged.
"""

import statistics
import time
from collections import Counter
from dataclasses import asdict, dataclass, field

from indicium.cases.dataset import LabelledCase
from indicium.policies.model import Policy
from indicium.review.engine import review
from indicium.review.providers import Provider
from indicium.text import locate


@dataclass
class CaseResult:
    case_id: str
    policy_id: str
    expected: str
    predicted: str | None
    flags: list[str]
    findings: dict[str, dict]  # criterion -> {gold, predicted, evidence_hit}
    quotes_given: int
    quotes_dropped: int
    latency_ms: int
    tokens_in: int
    tokens_out: int
    error: str | None = None
    tags: list[str] = field(default_factory=list)
    concerns: int = 0


def run_case(
    case: LabelledCase,
    policy: Policy,
    provider: Provider,
    min_confidence: float,
    approval_check: bool = True,
) -> CaseResult:
    started = time.perf_counter()
    try:
        outcome = review(case.request, policy, provider, min_confidence, approval_check)
    except Exception as error:  # a failed case is a result, not the end of the run
        return CaseResult(
            case.case_id, case.policy_id, case.expected, None, [], {}, 0, 0,
            round((time.perf_counter() - started) * 1000), 0, 0, f"{type(error).__name__}: {error}",
            case.tags,
        )  # fmt: skip
    notes = {d.doc_id: d.text for d in case.request.documents}
    findings = {}
    for f in outcome.findings:
        gold = case.labels[f.criterion_id]
        gold_spans = [
            (e.doc_id, span) for e in gold.evidence if (span := locate(e.quote, notes[e.doc_id]))
        ]
        hit = None
        if f.finding in ("documented", "contradicted") and f.evidence:
            hit = any(
                e["doc_id"] == doc and e["start"] < end and start < e["end"]
                for e in f.evidence
                for doc, (start, end) in gold_spans
            )
        findings[f.criterion_id] = {
            "gold": gold.finding,
            "predicted": f.finding,
            "evidence_hit": hit,
        }
    result = outcome.result
    return CaseResult(
        case_id=case.case_id,
        policy_id=case.policy_id,
        expected=case.expected,
        predicted=outcome.decision.recommendation,
        flags=sorted(outcome.flags),
        findings=findings,
        quotes_given=sum(len(f.evidence) + len(f.dropped) for f in outcome.findings),
        quotes_dropped=sum(len(f.dropped) for f in outcome.findings),
        latency_ms=round((time.perf_counter() - started) * 1000),
        tokens_in=result.tokens_in if result else 0,
        tokens_out=result.tokens_out if result else 0,
        tags=case.tags,
        concerns=len(outcome.concerns),
    )


def summarize(results: list[CaseResult]) -> dict:
    pairs = [(f["gold"], f["predicted"]) for r in results for f in r.findings.values()]
    tp = sum(g == "documented" and p == "documented" for g, p in pairs)
    fp = sum(g != "documented" and p == "documented" for g, p in pairs)
    fn = sum(g == "documented" and p != "documented" for g, p in pairs)
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    hits = [
        f["evidence_hit"]
        for r in results
        for f in r.findings.values()
        if f["evidence_hit"] is not None
    ]
    done = [r for r in results if r.error is None]
    latencies = sorted(r.latency_ms for r in done) or [0]
    injection = [r for r in results if "possible_injection" in r.tags]
    given = sum(r.quotes_given for r in results)
    return {
        "cases": len(results),
        "errors": len(results) - len(done),
        "criterion_precision": round(precision, 3),
        "criterion_recall": round(recall, 3),
        "criterion_f1": round(2 * precision * recall / (precision + recall), 3)
        if precision + recall
        else 0.0,
        "criterion_accuracy": round(sum(g == p for g, p in pairs) / len(pairs), 3)
        if pairs
        else 0.0,
        "evidence_hit_rate": round(sum(hits) / len(hits), 3) if hits else None,
        "quotes_discarded_rate": round(sum(r.quotes_dropped for r in results) / given, 3)
        if given
        else 0.0,
        "case_accuracy": round(sum(r.predicted == r.expected for r in results) / len(results), 3),
        "unsafe_approvals": sum(
            r.predicted == "meets_criteria" and r.expected != "meets_criteria" for r in results
        ),
        "missed_approvals": sum(
            r.expected == "meets_criteria" and r.predicted != "meets_criteria" for r in results
        ),
        "injection_caught": f"{sum('possible_injection' in r.flags for r in injection)}"
        f"/{len(injection)}",
        "latency_p50_ms": latencies[len(latencies) // 2],
        "latency_p95_ms": latencies[min(len(latencies) - 1, round(0.95 * (len(latencies) - 1)))],
        "tokens_in_mean": round(statistics.mean(r.tokens_in for r in done)) if done else 0,
        "tokens_out_mean": round(statistics.mean(r.tokens_out for r in done)) if done else 0,
        "approvals_stopped_by_check": sum(r.concerns > 0 for r in results),
        "confusion": dict(Counter(f"{r.expected} -> {r.predicted}" for r in results)),
    }


def to_json(results: list[CaseResult]) -> list[dict]:
    return [asdict(r) for r in results]


def from_json(rows: list[dict]) -> list[CaseResult]:
    return [CaseResult(**row) for row in rows]
