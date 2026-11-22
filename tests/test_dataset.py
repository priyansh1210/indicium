"""The labelled dataset is consistent with its policies, its own notes and the decision rules."""

from collections import Counter
from pathlib import Path

import pytest

from indicium.cases.dataset import read_cases
from indicium.policies.files import policy_files, read_policy
from indicium.review.rules import REFER_FLAGS, diagnosis_covered, recommend

POLICIES = {p.policy_id: p for p in map(read_policy, policy_files([Path("data/policies")]))}
CASES = read_cases(Path("data/cases"))
FINDING = {"documented": True, "contradicted": False, "absent": None}


def test_dataset_is_big_and_balanced_enough_to_mean_something():
    assert len(CASES) >= 40
    assert len({c.case_id for c in CASES}) == len(CASES), "case ids must be unique"
    outcomes = Counter(c.expected for c in CASES)
    assert min(outcomes.values()) >= 10, outcomes
    for policy_id in POLICIES:
        assert sum(c.policy_id == policy_id for c in CASES) >= 8, policy_id


@pytest.mark.parametrize("case", CASES, ids=lambda c: c.case_id)
def test_case_agrees_with_its_policy_notes_and_the_rules(case):
    from indicium.cases.dataset import check_case

    policy = POLICIES[case.policy_id]
    assert check_case(case, policy) == []
    flags = {t for t in case.tags if t in REFER_FLAGS}
    if not diagnosis_covered(policy, case.request.diagnosis_codes):
        flags.add("diagnosis_not_covered")
    findings = {cid: FINDING[label.finding] for cid, label in case.labels.items()}
    decision = recommend(policy, findings, flags, has_documents=bool(case.request.documents))
    assert decision.recommendation == case.expected, decision.reasons
