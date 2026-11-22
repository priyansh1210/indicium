import itertools

import pytest
from pydantic import ValidationError

from indicium.policies.model import Criterion, Group, Policy, criteria_of, evaluate

TEXT = (
    "Coverage requires four weeks of conservative care. "
    "Red flags include fever and saddle anesthesia. "
    "Imaging must change management."
)


def leaf(i: str, quote: str = "four weeks of conservative care") -> dict:
    return {
        "type": "criterion",
        "id": i,
        "text": f"criterion {i} is documented",
        "source_quote": quote,
    }


def policy(criteria: dict, **overrides) -> dict:
    return {
        "policy_id": "test-policy",
        "title": "Test policy",
        "source": {"kind": "manual", "document_id": "T1", "title": "Test"},
        "procedure_codes": [{"code": "72148"}],
        "criteria": criteria,
        "source_text": TEXT,
    } | overrides


def test_valid_policy_loads_and_lists_criteria_in_order():
    tree = {
        "type": "group",
        "op": "all",
        "label": "root",
        "items": [
            leaf("ca"),
            {"type": "group", "op": "any", "label": "flags", "items": [leaf("cb"), leaf("cc")]},
        ],
    }
    p = Policy.model_validate(policy(tree))
    assert [c.id for c in criteria_of(p.criteria)] == ["ca", "cb", "cc"]


@pytest.mark.parametrize(
    ("tree", "error"),
    [
        (
            {"type": "group", "op": "all", "label": "root", "items": [leaf("ca", "six weeks")]},
            "ca: source_quote is not in the policy text",
        ),
        (
            {"type": "group", "op": "all", "label": "root", "items": [leaf("ca"), leaf("ca")]},
            "criterion ids used more than once: ca",
        ),
        (
            {"type": "group", "op": "at_least", "n": 3, "label": "root", "items": [leaf("ca")]},
            "can never be met",
        ),
        (
            {"type": "group", "op": "any", "n": 1, "label": "root", "items": [leaf("ca")]},
            "only for at_least",
        ),
    ],
)
def test_invalid_policies_are_rejected_with_the_reason(tree, error):
    with pytest.raises(ValidationError, match=error):
        Policy.model_validate(policy(tree))


def test_unknown_fields_are_rejected():
    with pytest.raises(ValidationError, match="extra"):
        Policy.model_validate(policy(leaf("ca"), surprise=True))


def _reference(op: str, n: int | None, values: list[bool | None]) -> bool | None:
    """Kleene logic by brute force: True if every way of filling the unknowns gives True."""
    need = {"all": len(values), "any": 1, "at_least": n}[op]
    outcomes = {
        sum(filled) >= need
        for filled in itertools.product(*[[v] if v is not None else [True, False] for v in values])
    }
    return outcomes.pop() if len(outcomes) == 1 else None


@pytest.mark.parametrize(("op", "n"), [("all", None), ("any", None), ("at_least", 2)])
def test_evaluate_matches_three_valued_logic_for_every_combination(op, n):
    items = [
        Criterion(id=f"c{i}", text="x is documented", source_quote="whatever") for i in range(3)
    ]
    group = Group(op=op, n=n, label="group", items=items)
    for values in itertools.product([True, False, None], repeat=3):
        status = {f"c{i}": v for i, v in enumerate(values)}
        assert evaluate(group, status) == _reference(op, n, list(values)), values


def test_missing_status_is_unknown_never_met():
    group = Group(
        op="any",
        label="group",
        items=[Criterion(id="c0", text="x documented", source_quote="q" * 8)],
    )
    assert evaluate(group, {}) is None


def test_exclusion_blocks_only_when_documented():
    tree = Group(
        op="all",
        label="root",
        items=[
            Criterion(id="need", text="need is documented", source_quote="q" * 8),
            Criterion(
                id="infection", kind="exclusion", text="infection present", source_quote="q" * 8
            ),
        ],
    )
    assert evaluate(tree, {"need": True}) is True  # exclusion not mentioned: does not block
    assert evaluate(tree, {"need": True, "infection": False}) is True
    assert evaluate(tree, {"need": True, "infection": True}) is False
    assert evaluate(tree, {"infection": False}) is None  # still needs the required item


@pytest.mark.parametrize(
    ("tree", "error"),
    [
        (
            {
                "type": "group",
                "op": "any",
                "label": "root",
                "items": [leaf("ca"), leaf("cb") | {"kind": "exclusion"}],
            },
            "exclusions belong only in an 'all' group",
        ),
        (
            {
                "type": "group",
                "op": "all",
                "label": "root",
                "items": [leaf("ca") | {"kind": "exclusion"}],
            },
            "needs at least one required criterion",
        ),
    ],
)
def test_exclusions_cannot_create_an_approval_path(tree, error):
    with pytest.raises(ValidationError, match=error):
        Policy.model_validate(policy(tree))


def test_a_group_of_only_exclusions_is_rejected_anywhere_in_the_tree():
    only_exclusions = {
        "type": "group",
        "op": "all",
        "label": "nested",
        "items": [leaf("cb") | {"kind": "exclusion"}],
    }
    tree = {"type": "group", "op": "any", "label": "root", "items": [only_exclusions, leaf("ca")]}
    with pytest.raises(ValidationError, match="'nested' needs at least one required criterion"):
        Policy.model_validate(policy(tree))


def test_codes_are_uppercased_before_they_are_checked():
    tree = {"type": "group", "op": "all", "label": "root", "items": [leaf("ca")]}
    p = Policy.model_validate(
        policy(tree, procedure_codes=[{"code": " e0601 "}], diagnosis_codes=["g47.33"])
    )
    assert (p.procedure_codes[0].code, p.diagnosis_codes) == ("E0601", ["G47.33"])
