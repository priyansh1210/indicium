import base64

import pytest
from pydantic import ValidationError

from indicium.cases.fhir import FhirError, request_from_bundle


def text(s: str) -> str:
    return base64.b64encode(s.encode()).decode()


def bundle(**overrides) -> dict:
    resources = {
        "Patient": {
            "resourceType": "Patient",
            "id": "p1",
            "identifier": [{"system": "urn:plan:member", "value": "SYN-1001"}],
            "name": [{"given": ["Ada"], "family": "Rivera"}],
            "birthDate": "1960-02-01",
            "gender": "female",
        },
        "ServiceRequest": {
            "resourceType": "ServiceRequest",
            "id": "sr1",
            "identifier": [{"value": "portal-777"}],
            "priority": "urgent",
            "code": {
                "coding": [
                    {"system": "http://snomed.info/sct", "code": "241646009"},
                    {"system": "http://www.ama-assn.org/go/cpt", "code": "72148"},
                ]
            },
            "reasonCode": [
                {"coding": [{"system": "http://hl7.org/fhir/sid/icd-10-cm", "code": "M54.16"}]}
            ],
            "requester": {"display": "Elm Street Primary Care"},
        },
        "Condition": {
            "resourceType": "Condition",
            "code": {"coding": [{"system": "http://hl7.org/fhir/sid/icd-10-cm", "code": "M51.16"}]},
        },
        "DocumentReference": {
            "resourceType": "DocumentReference",
            "id": "Note.2026/11/01",
            "type": {"coding": [{"system": "http://loinc.org", "code": "11506-3"}]},
            "author": [{"display": "J. Moreau, PA-C"}],
            "date": "2026-11-01T09:30:00Z",
            "content": [
                {
                    "attachment": {
                        "contentType": "text/plain",
                        "data": text("Six weeks of PT failed."),
                    }
                }
            ],
        },
    } | overrides
    return {
        "resourceType": "Bundle",
        "type": "collection",
        "entry": [{"resource": r} for r in resources.values() if r is not None],
    }


def test_bundle_becomes_a_validated_request():
    request = request_from_bundle(bundle())
    assert request.external_id == "portal-777"
    assert (request.patient.member_id, request.patient.name) == ("SYN-1001", "Ada Rivera")
    assert request.procedure_code == "72148"  # the SNOMED coding is skipped
    assert request.diagnosis_codes == ["M54.16", "M51.16"]
    assert request.urgency == "expedited"
    doc = request.documents[0]
    assert (doc.doc_id, doc.kind, str(doc.written_on)) == (
        "note-2026-11-01",
        "progress_note",
        "2026-11-01",
    )
    assert doc.text == "Six weeks of PT failed."


@pytest.mark.parametrize(
    ("change", "error"),
    [
        ({"Patient": None}, "exactly one Patient"),
        (
            {"ServiceRequest": {"resourceType": "ServiceRequest", "code": {"coding": []}}},
            "no CPT or HCPCS",
        ),
        (
            {"DocumentReference": {"resourceType": "DocumentReference", "id": "scan",
             "content": [{"attachment": {"contentType": "application/pdf", "data": "JVBE"}}]}},
            "only inline text attachments",
        ),
        (
            {"DocumentReference": {"resourceType": "DocumentReference", "id": "bad",
             "content": [{"attachment": {"contentType": "text/plain", "data": "%%%"}}]}},
            "unreadable text",
        ),
    ],
)  # fmt: skip
def test_unsupported_bundles_are_rejected_with_the_reason(change, error):
    with pytest.raises(FhirError, match=error):
        request_from_bundle(bundle(**change))


def test_bundle_still_goes_through_request_validation():
    no_diagnosis = bundle(Condition=None)
    no_diagnosis["entry"][1]["resource"].pop("reasonCode")
    with pytest.raises(ValidationError, match="diagnosis_codes"):
        request_from_bundle(no_diagnosis)


def test_documents_without_usable_ids_still_get_unique_ones():
    note = {
        "resourceType": "DocumentReference",
        "content": [{"attachment": {"contentType": "text/plain", "data": text("first note")}}],
    }
    request = request_from_bundle(bundle(DocumentReference=note))
    two = bundle()
    two["entry"] += [{"resource": note}, {"resource": note | {"id": "x" * 64}}]
    ids = [d.doc_id for d in request_from_bundle(two).documents]
    assert request.documents[0].doc_id == "doc-1"
    assert ids == ["note-2026-11-01", "doc-2", "x" * 60]
