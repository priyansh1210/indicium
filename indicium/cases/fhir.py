"""A FHIR R4 Bundle as a prior-authorization request.

Read: Patient (member id, name, birth date, sex), ServiceRequest (procedure code, priority,
requester, reasons), Condition (diagnoses) and DocumentReference (notes as inline text).
Everything else in the bundle is ignored. The result goes through the same validation as a JSON
request, so a FHIR client gets no shortcuts around it.
"""

import base64
import binascii
import re
from typing import Any

from indicium.cases.model import CaseRequest

PROCEDURE_SYSTEMS = {
    "http://www.ama-assn.org/go/cpt",
    "https://www.cms.gov/Medicare/Coding/HCPCSReleaseCodeSets",
    "http://www.cms.gov/Medicare/Coding/HCPCSReleaseCodeSets",
}
ICD10 = "http://hl7.org/fhir/sid/icd-10-cm"
LOINC = "http://loinc.org"
# LOINC document type -> our document kind. Unknown types become "other".
DOCUMENT_KINDS = {
    "11506-3": "progress_note",
    "11488-4": "progress_note",  # consult note
    "34117-2": "progress_note",  # history and physical
    "18748-4": "imaging_report",
    "18842-5": "progress_note",  # discharge summary
    "28570-0": "operative_note",  # procedure note
    "11504-8": "operative_note",
    "57133-1": "referral",
    "11505-5": "therapy_note",  # physical therapy note
}
URGENT = {"urgent", "asap", "stat"}


class FhirError(ValueError):
    pass


def request_from_bundle(bundle: dict[str, Any]) -> CaseRequest:
    if not isinstance(bundle, dict) or bundle.get("resourceType") != "Bundle":
        raise FhirError("expected a FHIR Bundle")
    resources: dict[str, list[dict]] = {}
    for entry in bundle.get("entry") or []:
        resource = (entry or {}).get("resource") or {}
        resources.setdefault(resource.get("resourceType", ""), []).append(resource)

    patient = _one(resources, "Patient")
    service = _one(resources, "ServiceRequest")
    procedure = _code(service.get("code"), PROCEDURE_SYSTEMS)
    if not procedure:
        raise FhirError("ServiceRequest.code has no CPT or HCPCS coding")
    diagnoses = [c for r in service.get("reasonCode") or [] if (c := _code(r, {ICD10}))]
    diagnoses += [c for r in resources.get("Condition", []) if (c := _code(r.get("code"), {ICD10}))]

    return CaseRequest.model_validate(
        {
            "external_id": _identifier(service) or _identifier(bundle) or service.get("id"),
            "patient": {
                "member_id": _identifier(patient) or patient.get("id"),
                "name": _name(patient),
                "birth_date": patient.get("birthDate"),
                "sex": patient.get("gender") or "unknown",
            },
            "procedure_code": procedure,
            "diagnosis_codes": list(dict.fromkeys(diagnoses)),
            "urgency": "expedited" if service.get("priority") in URGENT else "standard",
            "requested_by": ((service.get("requester") or {}).get("display") or "unknown"),
            "documents": [
                _document(r, n) for n, r in enumerate(resources.get("DocumentReference", []), 1)
            ],
        }
    )


def _one(resources: dict[str, list[dict]], kind: str) -> dict:
    found = resources.get(kind, [])
    if len(found) != 1:
        raise FhirError(f"the bundle must contain exactly one {kind}, not {len(found)}")
    return found[0]


def _code(concept: dict | None, systems: set[str]) -> str | None:
    for coding in (concept or {}).get("coding") or []:
        if coding.get("system") in systems and coding.get("code"):
            return coding["code"]
    return None


def _identifier(resource: dict) -> str | None:
    identifiers = resource.get("identifier")
    if isinstance(identifiers, dict):  # Bundle.identifier is a single value
        identifiers = [identifiers]
    return next((i["value"] for i in identifiers or [] if i.get("value")), None)


def _name(patient: dict) -> str:
    name = (patient.get("name") or [{}])[0]
    return name.get("text") or " ".join([*name.get("given", []), name.get("family", "")]).strip()


def _document(reference: dict, number: int) -> dict:
    # FHIR ids are optional inside a bundle and may be up to 64 characters; ours are shorter slugs.
    slug = re.sub(r"[^a-z0-9_-]+", "-", (reference.get("id") or "").lower()).strip("-_")[:60]
    doc_id = slug if len(slug) >= 2 else f"doc-{number}"
    texts = []
    for content in reference.get("content") or []:
        attachment = content.get("attachment") or {}
        if not str(attachment.get("contentType", "")).startswith("text/"):
            raise FhirError(
                f"DocumentReference {reference.get('id')}: only inline text attachments are read, "
                f"not {attachment.get('contentType') or 'an untyped attachment'}"
            )
        try:
            texts.append(base64.b64decode(attachment.get("data") or "", validate=True).decode())
        except (binascii.Error, UnicodeDecodeError) as error:
            raise FhirError(f"DocumentReference {reference.get('id')}: unreadable text") from error
    loinc = _code(reference.get("type"), {LOINC})
    return {
        "doc_id": doc_id,
        "kind": DOCUMENT_KINDS.get(loinc or "", "other"),
        "author": ((reference.get("author") or [{}])[0].get("display") or ""),
        "written_on": (reference.get("date") or "")[:10] or None,
        "text": "\n\n".join(texts),
    }
