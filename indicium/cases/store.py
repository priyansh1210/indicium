"""Cases in the database."""

import hashlib
from datetime import timedelta

from psycopg import Connection
from psycopg.errors import UniqueViolation
from psycopg.types.json import Jsonb

from indicium.cases.model import CaseRequest, ClinicalDocument
from indicium.config import settings
from indicium.db import audit


class DuplicateRequest(Exception):
    """The external id (or a document id) is already used for different content."""


def create_case(conn: Connection, request: CaseRequest, actor: str) -> tuple[int, bool]:
    """Store a request and its documents. Returns (case_id, created).

    Sending the same request again (same external id and content) returns the first case, so a
    client can safely retry after a timeout.
    """
    digest = hashlib.sha256(request.model_dump_json().encode()).hexdigest()
    # Serializes concurrent submissions of the same external id (a client retrying in parallel).
    conn.execute("select pg_advisory_xact_lock(hashtext('case:' || %s))", (request.external_id,))
    existing = conn.execute(
        "select case_id, request_hash from app.cases where external_id = %s",
        (request.external_id,),
    ).fetchone()
    if existing:
        if existing["request_hash"] != digest:
            raise DuplicateRequest(
                f"external id {request.external_id!r} was already used for a different request"
            )
        return existing["case_id"], False

    s = settings()
    hours = s.sla_expedited_hours if request.urgency == "expedited" else s.sla_standard_hours
    case_id = conn.execute(
        "insert into app.cases (external_id, request_hash, patient, procedure_code,"
        " diagnosis_codes, urgency, requested_by, due_at, created_by)"
        " values (%s, %s, %s, %s, %s, %s, %s, now() + %s, %s) returning case_id",
        (
            request.external_id,
            digest,
            Jsonb(request.patient.model_dump(mode="json")),
            request.procedure_code,
            request.diagnosis_codes,
            request.urgency,
            request.requested_by,
            timedelta(hours=hours),
            actor,
        ),
    ).fetchone()["case_id"]
    _insert_documents(conn, case_id, request.documents)
    audit(
        conn,
        actor,
        "case.received",
        "case",
        case_id,
        {"external_id": request.external_id, "documents": len(request.documents)},
    )
    return case_id, True


def add_documents(
    conn: Connection, case_id: int, documents: list[ClinicalDocument], actor: str
) -> None:
    """Attach more documents to a case (the answer to a request for information)."""
    try:
        _insert_documents(conn, case_id, documents)
    except UniqueViolation as error:
        raise DuplicateRequest("a document with that id is already on this case") from error
    audit(
        conn,
        actor,
        "case.documents_added",
        "case",
        case_id,
        {"doc_ids": [d.doc_id for d in documents]},
    )


def _insert_documents(conn: Connection, case_id: int, documents: list[ClinicalDocument]) -> None:
    with conn.cursor() as cur:
        cur.executemany(
            "insert into app.documents (case_id, doc_id, kind, author, written_on, text, sha256)"
            " values (%s, %s, %s, %s, %s, %s, %s)",
            [
                (
                    case_id,
                    d.doc_id,
                    d.kind,
                    d.author,
                    d.written_on,
                    d.text,
                    hashlib.sha256(d.text.encode()).hexdigest(),
                )
                for d in documents
            ],
        )


def load_request(conn: Connection, case_id: int) -> CaseRequest:
    """The request as it was received, rebuilt from the stored case."""
    case = conn.execute("select * from app.cases where case_id = %s", (case_id,)).fetchone()
    if not case:
        raise LookupError(f"case {case_id} does not exist")
    documents = conn.execute(
        "select doc_id, kind, author, written_on, text from app.documents"
        " where case_id = %s order by written_on nulls last, doc_id",
        (case_id,),
    ).fetchall()
    return CaseRequest.model_validate(
        {
            "external_id": case["external_id"],
            "patient": case["patient"],
            "procedure_code": case["procedure_code"],
            "diagnosis_codes": case["diagnosis_codes"],
            "urgency": case["urgency"],
            "requested_by": case["requested_by"],
            "documents": documents,
        }
    )


def set_status(conn: Connection, case_id: int, status: str, actor: str, detail: dict) -> None:
    """Move a case to a new status. The database refuses a move that is not allowed."""
    old = conn.execute(
        "select status from app.cases where case_id = %s for update", (case_id,)
    ).fetchone()
    if not old:
        raise LookupError(f"case {case_id} does not exist")
    conn.execute("update app.cases set status = %s where case_id = %s", (status, case_id))
    audit(conn, actor, f"case.{status}", "case", case_id, {"from": old["status"]} | detail)
