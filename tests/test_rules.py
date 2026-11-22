from pathlib import Path

import pytest

from indicium.policies.files import read_policy
from indicium.review.rules import diagnosis_covered, recommend

POLICY = read_policy(Path("data/policies/cms-l34220-lumbar-mri.yaml"))
MET = {"red_flag": True, "results_guide_treatment": True}


def test_met_policy_with_no_flags_meets_criteria():
    assert recommend(POLICY, MET, set(), has_documents=True).recommendation == "meets_criteria"


def test_any_flag_overrides_a_met_policy():
    decision = recommend(POLICY, MET, {"possible_injection"}, has_documents=True)
    assert decision.recommendation == "refer_to_clinician"
    assert "instructions" in decision.reasons[0]


def test_missing_information_pends_and_contradiction_refers():
    pend = recommend(POLICY, {"red_flag": True}, set(), has_documents=True)
    assert pend.recommendation == "pend_for_info"
    refer = recommend(POLICY, MET | {"investigational_use": True}, set(), has_documents=True)
    assert refer.recommendation == "refer_to_clinician"


def test_no_documents_pends_even_if_findings_claim_otherwise():
    assert recommend(POLICY, MET, set(), has_documents=False).recommendation == "pend_for_info"


def test_an_unknown_flag_is_an_error_not_a_silent_pass():
    with pytest.raises(ValueError, match="unknown flags"):
        recommend(POLICY, MET, {"posible_injection"}, has_documents=True)


def test_no_outcome_is_ever_a_denial():
    outcomes = {
        recommend(
            POLICY, {k: v for k, v in zip(MET, values, strict=True)}, flags, docs
        ).recommendation
        for values in [(True, True), (False, False), (None, None), (True, False)]
        for flags in [set(), {"low_confidence"}]
        for docs in [True, False]
    }
    assert outcomes <= {"meets_criteria", "pend_for_info", "refer_to_clinician"}


@pytest.mark.parametrize(
    ("codes", "covered"), [(["M54.16"], True), (["M5416"], True), (["Z00.00"], False)]
)
def test_diagnosis_codes_match_with_or_without_the_dot(codes, covered):
    assert diagnosis_covered(POLICY, codes) is covered


def test_a_person_setting_an_uncertain_item_resolves_it_but_not_case_level_flags():
    from indicium.review.rules import with_overrides

    findings = [
        {"criterion_id": "red_flag", "finding": "documented", "confidence": 0.9},
        {"criterion_id": "results_guide_treatment", "finding": "absent", "confidence": 0.3},
    ]
    before = with_overrides(POLICY, findings, {}, {"low_confidence"}, True, 0.6)
    assert before.recommendation == "refer_to_clinician"
    after = with_overrides(
        POLICY, findings, {"results_guide_treatment": "documented"}, {"low_confidence"}, True, 0.6
    )
    assert after.recommendation == "meets_criteria"
    injected = with_overrides(
        POLICY,
        findings,
        {"results_guide_treatment": "documented"},
        {"possible_injection"},
        True,
        0.6,
    )
    assert injected.recommendation == "refer_to_clinician"
