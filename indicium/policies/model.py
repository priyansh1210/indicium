"""A coverage policy as data: codes it applies to, and a tree of criteria drawn from its text.

The tree has groups (`all`, `any`, `at_least`) over leaf criteria. Each criterion is a statement
that the notes either document (True), contradict (False) or do not mention (None).

- A `required` criterion counts as met only when documented. Unknown never counts as met, so a
  gap in the notes can only lead to a person, not an approval.
- An `exclusion` (a contraindication, a frequency limit, a non-covered use) blocks only when the
  notes document it; notes rarely state that something did not happen. Exclusions may sit only
  directly under an `all` group, where an exclusion that does not apply cannot carry a group alone.
"""

from datetime import date, datetime
from typing import Annotated, Literal, Union

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from indicium.text import locate

Slug = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9_-]{1,62}$")]
# Uppercased before the pattern check: pydantic checks a pattern before its own to_upper.
Code = Annotated[
    str,
    StringConstraints(pattern=r"^[A-Z0-9][A-Z0-9.]{2,9}$"),
    BeforeValidator(lambda v: v.strip().upper() if isinstance(v, str) else v),
]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Criterion(Strict):
    type: Literal["criterion"] = "criterion"
    id: Slug
    kind: Literal["required", "exclusion"] = "required"
    text: str = Field(min_length=10, max_length=600, description="What the notes must show")
    guidance: str = Field("", max_length=1500, description="What does and does not count")
    source_quote: str = Field(min_length=8, description="The policy sentence it comes from")


class Group(Strict):
    type: Literal["group"] = "group"
    op: Literal["all", "any", "at_least"]
    n: int | None = Field(None, ge=1, description="For at_least: how many items must be met")
    label: str = Field(min_length=3, max_length=300)
    items: list[Annotated[Union[Criterion, "Group"], Field(discriminator="type")]] = Field(
        min_length=1
    )

    @model_validator(mode="after")
    def _n_fits(self) -> "Group":
        if (self.op == "at_least") != (self.n is not None):
            raise ValueError("n is required for at_least and only for at_least")
        if self.n is not None and self.n > len(self.items):
            raise ValueError(f"at_least {self.n} of only {len(self.items)} items can never be met")
        if self.op != "all" and any(getattr(i, "kind", None) == "exclusion" for i in self.items):
            raise ValueError(f"group {self.label!r}: exclusions belong only in an 'all' group")
        # A group of exclusions alone is met by notes that say nothing, which would make an
        # `any` above it pass on empty notes.
        if all(c.kind == "exclusion" for c in criteria_of(self)):
            raise ValueError(f"group {self.label!r} needs at least one required criterion")
        return self


Group.model_rebuild()  # the tree refers to itself


class Source(Strict):
    kind: Literal["cms_lcd", "manual"]
    document_id: str = Field(min_length=1, max_length=40, description="e.g. L34220")
    version: int | None = Field(None, ge=1)
    title: str = Field(min_length=3, max_length=300)
    url: str | None = None
    effective_date: date | None = None
    contractor: str | None = None
    retrieved_at: datetime | None = None


class ProcedureCode(Strict):
    code: Code
    description: str = ""


class Policy(Strict):
    policy_id: Slug
    title: str = Field(min_length=3, max_length=300)
    source: Source
    procedure_codes: list[ProcedureCode] = Field(min_length=1)
    # Covered ICD-10 codes from the billing article. Empty means the policy lists none.
    diagnosis_codes: list[Code] = []
    criteria: Group
    source_text: str = Field(min_length=50)

    @model_validator(mode="after")
    def _consistent(self) -> "Policy":
        problems = []
        ids = [c.id for c in criteria_of(self.criteria)]
        if duplicates := sorted({i for i in ids if ids.count(i) > 1}):
            problems.append(f"criterion ids used more than once: {', '.join(duplicates)}")
        for c in criteria_of(self.criteria):
            if locate(c.source_quote, self.source_text) is None:
                problems.append(f"{c.id}: source_quote is not in the policy text")
        codes = [p.code for p in self.procedure_codes]
        if len(set(codes)) != len(codes):
            problems.append("a procedure code is listed more than once")
        if problems:
            raise ValueError("; ".join(problems))
        return self


def criteria_of(node: Group | Criterion) -> list[Criterion]:
    """Every leaf criterion, in reading order."""
    if isinstance(node, Criterion):
        return [node]
    return [c for item in node.items for c in criteria_of(item)]


def evaluate(node: Group | Criterion, status: dict[str, bool | None]) -> bool | None:
    """Three-valued result of the tree. `status` maps criterion id to documented / contradicted /
    not mentioned (True / False / None); a missing id is not mentioned."""
    if isinstance(node, Criterion):
        if node.kind == "exclusion":
            return status.get(node.id) is not True
        return status.get(node.id)
    results = [evaluate(item, status) for item in node.items]
    met, unknown = results.count(True), results.count(None)
    need = {"all": len(results), "any": 1, "at_least": node.n}[node.op]
    if met >= need:
        return True
    if met + unknown < need:
        return False
    return None
