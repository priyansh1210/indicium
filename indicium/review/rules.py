"""Decision rules: from the criterion findings to a recommendation. Code, never a model.

There are three possible outcomes and none of them is a denial:
- meets_criteria: every needed criterion is documented and nothing looks wrong.
- pend_for_info: something needed is not documented yet; ask the provider for it.
- refer_to_clinician: the notes argue against coverage, or something needs a person's judgement.
  Only a physician reviewer may deny, and only after reading the case.
"""

from dataclasses import dataclass
from typing import Literal

from indicium.policies.model import Policy, evaluate

Recommendation = Literal["meets_criteria", "pend_for_info", "refer_to_clinician"]

# Conditions found outside the criteria that always send a case to a person.
REFER_FLAGS = {
    "diagnosis_not_covered": "The diagnosis codes are not on the policy's covered list.",
    "possible_injection": "A note contains text that reads like instructions to the reviewer.",
    "conflicting_evidence": "The notes contradict each other on a criterion.",
    "low_confidence": "The extraction was not confident about at least one criterion.",
    "extraction_failed": "The notes could not be read automatically.",
}


@dataclass(frozen=True)
class Decision:
    recommendation: Recommendation
    reasons: list[str]


def recommend(
    policy: Policy, findings: dict[str, bool | None], flags: set[str], has_documents: bool
) -> Decision:
    """`findings` maps criterion id to documented (True), contradicted (False) or absent (None)."""
    if unknown := flags - REFER_FLAGS.keys():
        raise ValueError(f"unknown flags: {sorted(unknown)}")  # a typo must not skip a person
    if not has_documents:
        return Decision("pend_for_info", ["No clinical documentation was submitted."])
    reasons = [REFER_FLAGS[f] for f in sorted(flags)]
    result = evaluate(policy.criteria, findings)
    if result is False:
        reasons.insert(0, "The notes document a reason the policy is not met.")
    if reasons:
        return Decision("refer_to_clinician", reasons)
    if result is None:
        return Decision("pend_for_info", ["Required information is not documented yet."])
    return Decision("meets_criteria", ["Every required criterion is documented."])


def diagnosis_covered(policy: Policy, codes: list[str]) -> bool:
    """True when the policy lists no covered diagnoses, or one of the codes is on its list.
    ICD-10 codes are written with and without the dot (M54.16, M5416); both match."""
    listed = {c.replace(".", "") for c in policy.diagnosis_codes}
    return not listed or any(c.replace(".", "") in listed for c in codes)
