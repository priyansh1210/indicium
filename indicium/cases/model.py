"""A prior-authorization request as it arrives: who, what service, why, and the clinical notes.

Everything here crosses a trust boundary (a provider portal, a FHIR client, a file), so it is
validated strictly: unknown fields, oversized text and malformed codes are rejected.
"""

from datetime import date
from typing import Literal

from pydantic import Field, model_validator

from indicium.policies.model import Code, Slug, Strict

Urgency = Literal["standard", "expedited"]
DocumentKind = Literal[
    "progress_note",
    "imaging_report",
    "sleep_study",
    "therapy_note",
    "referral",
    "operative_note",
    "other",
]


class Patient(Strict):
    member_id: str = Field(min_length=3, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    birth_date: date
    sex: Literal["female", "male", "other", "unknown"] = "unknown"


class ClinicalDocument(Strict):
    doc_id: Slug
    kind: DocumentKind = "other"
    author: str = Field("", max_length=200)
    written_on: date | None = None
    text: str = Field(min_length=1, max_length=200_000)


class CaseRequest(Strict):
    # The submitter's own id for the request. Sending the same id twice returns the first case.
    external_id: str = Field(min_length=3, max_length=128)
    patient: Patient
    procedure_code: Code
    diagnosis_codes: list[Code] = Field(min_length=1, max_length=25)
    urgency: Urgency = "standard"
    requested_by: str = Field(min_length=1, max_length=200)
    # No notes is allowed: such a request is accepted and pended for information, not rejected.
    documents: list[ClinicalDocument] = Field([], max_length=50)

    @model_validator(mode="after")
    def _unique_documents(self) -> "CaseRequest":
        ids = [d.doc_id for d in self.documents]
        if len(set(ids)) != len(ids):
            raise ValueError("document ids must be unique within a request")
        return self
