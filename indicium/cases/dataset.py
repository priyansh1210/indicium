"""The labelled evaluation dataset: synthetic requests with the answer for every criterion.

A case file is a request plus its labels. Labels are set when the case is written (the notes are
written to match them), and `check` proves every labelled evidence sentence is really in the
notes, with the same quote finder the review engine uses. Cases live in data/cases/<policy_id>/.
"""

from pathlib import Path
from typing import Literal

import yaml
from pydantic import Field, model_validator

from indicium.cases.model import CaseRequest
from indicium.policies.model import Policy, Strict, criteria_of
from indicium.text import locate

Finding = Literal["documented", "contradicted", "absent", "conflicting"]
Recommendation = Literal["meets_criteria", "pend_for_info", "refer_to_clinician"]


class Evidence(Strict):
    doc_id: str
    quote: str = Field(min_length=8)


class Label(Strict):
    finding: Finding
    # The sentence(s) a reviewer would point to. Required unless the finding is "absent".
    evidence: list[Evidence] = []  # for every finding except "absent"

    @model_validator(mode="after")
    def _evidence_matches_finding(self) -> "Label":
        if (self.finding == "absent") != (not self.evidence):
            raise ValueError("evidence is required for documented/contradicted and only for those")
        return self


class LabelledCase(Strict):
    case_id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{2,80}$")
    policy_id: str
    description: str = Field(min_length=10, description="What this case tests, for people")
    tags: list[str] = []
    request: CaseRequest
    labels: dict[str, Label]
    expected: Recommendation


def check_case(case: LabelledCase, policy: Policy) -> list[str]:
    """Every way the case disagrees with its policy or its own notes."""
    problems = []
    if case.request.procedure_code not in {p.code for p in policy.procedure_codes}:
        problems.append(f"procedure {case.request.procedure_code} is not in {policy.policy_id}")
    ids = {c.id for c in criteria_of(policy.criteria)}
    if missing := ids - case.labels.keys():
        problems.append(f"no label for: {', '.join(sorted(missing))}")
    if unknown := case.labels.keys() - ids:
        problems.append(
            f"labels for criteria the policy does not have: {', '.join(sorted(unknown))}"
        )
    notes = {d.doc_id: d.text for d in case.request.documents}
    for criterion_id, label in case.labels.items():
        for e in label.evidence:
            if e.doc_id not in notes:
                problems.append(f"{criterion_id}: no document {e.doc_id}")
            elif locate(e.quote, notes[e.doc_id]) is None:
                problems.append(f"{criterion_id}: evidence is not in {e.doc_id}: {e.quote!r}")
    return problems


def read_cases(root: Path) -> list[LabelledCase]:
    cases = []
    for path in sorted(root.rglob("*.yaml")):
        try:
            cases.append(LabelledCase.model_validate(yaml.safe_load(path.read_text("utf-8"))))
        except (yaml.YAMLError, ValueError) as error:
            raise ValueError(f"{path}: {error}") from error
    return cases
