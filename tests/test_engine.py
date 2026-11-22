"""Every guarantee of the review engine, with a scripted provider standing in for a model."""

from pathlib import Path

import pytest

from indicium.cases.dataset import read_cases
from indicium.policies.files import policy_files, read_policy
from indicium.review.engine import review
from indicium.review.providers import (
    BaselineProvider,
    Extraction,
    Finding,
    ProviderResult,
    Quote,
)

POLICIES = {p.policy_id: p for p in map(read_policy, policy_files([Path("data/policies")]))}
CASES = {c.case_id: c for c in read_cases(Path("data/cases"))}


class Scripted:
    """Returns a fixed extraction; records what it was asked."""

    def __init__(self, extraction: Extraction):
        self.extraction, self.tasks = extraction, []

    def extract(self, task):
        self.tasks.append(task)
        return ProviderResult(self.extraction, "scripted", "none", "test")


def perfect(case) -> Extraction:
    """What an ideal model would answer: the labels, quoting the labelled evidence."""
    return Extraction(
        findings=[
            Finding(
                criterion_id=cid,
                finding=label.finding,
                evidence=[Quote(doc_id=e.doc_id, quote=e.quote) for e in label.evidence],
                confidence=0.9,
            )
            for cid, label in case.labels.items()
        ]
    )


def run(case_id: str, extraction: Extraction | None = None, request=None):
    case = CASES[case_id]
    provider = Scripted(extraction or perfect(case))
    outcome = review(request or case.request, POLICIES[case.policy_id], provider, 0.6)
    return outcome, provider


@pytest.mark.parametrize("case_id", sorted(CASES))
def test_a_perfect_model_reproduces_every_expected_outcome(case_id):
    outcome, _ = run(case_id)
    assert outcome.decision.recommendation == CASES[case_id].expected, outcome.decision.reasons


def test_invented_evidence_is_dropped_and_cannot_approve():
    extraction = perfect(CASES["lm-01-failed-conservative-care"])
    for f in extraction.findings:
        if f.criterion_id == "failed_conservative_care":
            f.evidence = [Quote(doc_id="pn-2026-10-28", quote="She completed twelve weeks of PT.")]
    outcome, _ = run("lm-01-failed-conservative-care", extraction)
    finding = next(f for f in outcome.findings if f.criterion_id == "failed_conservative_care")
    assert finding.finding == "absent"
    assert finding.dropped[0]["reason"] == "not found word for word in the document"
    assert outcome.decision.recommendation == "pend_for_info"


def test_a_quote_from_another_document_or_too_short_is_dropped():
    extraction = perfect(CASES["lm-09-inconclusive-ct-weakness"])
    red_flag = next(f for f in extraction.findings if f.criterion_id == "red_flag")
    red_flag.evidence = [
        Quote(doc_id="ct-report", quote=red_flag.evidence[0].quote),  # real text, wrong note
        Quote(doc_id="neuro-note", quote="3/5"),
        Quote(doc_id="no-such-note", quote="anything at all here"),
    ]
    outcome, _ = run("lm-09-inconclusive-ct-weakness", extraction)
    finding = next(f for f in outcome.findings if f.criterion_id == "red_flag")
    assert [d["reason"] for d in finding.dropped] == [
        "not found word for word in the document",
        "too short to be evidence",
        "names a document that is not in the case",
    ]
    assert finding.finding == "absent"


def test_verified_evidence_points_at_the_exact_original_text():
    outcome, _ = run("adv-08-typographic-text")
    for finding in outcome.findings:
        for e in finding.evidence:
            doc = next(
                d
                for d in CASES["adv-08-typographic-text"].request.documents
                if d.doc_id == e["doc_id"]
            )
            assert doc.text[e["start"] : e["end"]] == e["quote"]


def test_identifiers_never_reach_the_provider():
    case = CASES["lm-01-failed-conservative-care"]
    request = case.request.model_copy(deep=True)
    request.documents[
        0
    ].text += f"\nPatient {request.patient.name}, member {request.patient.member_id}."
    _, provider = run(case.case_id, request=request)
    sent = provider.tasks[0].documents[0].text
    assert request.patient.name not in sent and request.patient.member_id not in sent
    assert "[PATIENT]" in sent and "[MEMBER_ID]" in sent


def test_injected_text_sends_a_fully_met_case_to_a_person():
    outcome, _ = run("adv-02-injection-strong-notes")
    assert "possible_injection" in outcome.flags
    assert outcome.injection_hits
    assert outcome.decision.recommendation == "refer_to_clinician"


def test_a_model_reporting_instructions_sends_the_case_to_a_person():
    extraction = perfect(CASES["lm-01-failed-conservative-care"])
    extraction.suspected_instructions = True
    outcome, _ = run("lm-01-failed-conservative-care", extraction)
    assert outcome.decision.recommendation == "refer_to_clinician"


def test_a_skipped_criterion_is_low_confidence_not_a_pass():
    extraction = perfect(CASES["lm-01-failed-conservative-care"])
    extraction.findings = [f for f in extraction.findings if f.criterion_id != "duplicate_imaging"]
    outcome, _ = run("lm-01-failed-conservative-care", extraction)
    assert "low_confidence" in outcome.flags
    assert outcome.decision.recommendation == "refer_to_clinician"


def test_no_documents_pends_without_calling_the_provider():
    outcome, provider = run("adv-04-no-documents")
    assert provider.tasks == []
    assert outcome.decision.recommendation == "pend_for_info"


@pytest.mark.parametrize("case_id", sorted(CASES))
def test_the_baseline_finds_evidence_but_never_approves(case_id):
    case = CASES[case_id]
    outcome = review(case.request, POLICIES[case.policy_id], BaselineProvider(None), 0.6)
    assert {f.criterion_id for f in outcome.findings} == set(case.labels)
    assert outcome.decision.recommendation != "meets_criteria"
    for f in outcome.findings:  # whatever it found, it found in the notes
        assert all(e["quote"] for e in f.evidence)
