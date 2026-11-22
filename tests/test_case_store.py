from pathlib import Path

import psycopg
import pytest
from psycopg.rows import dict_row

from indicium.cases.dataset import read_cases
from indicium.cases.store import DuplicateRequest, create_case, set_status

CASES = read_cases(Path("data/cases"))


@pytest.fixture(scope="module")
def conn(db_url):
    with psycopg.connect(db_url, row_factory=dict_row) as conn:
        yield conn


def test_resubmitting_returns_the_same_case_and_changes_are_refused(conn):
    request = next(c.request for c in CASES if c.request.urgency == "expedited")
    case_id, created = create_case(conn, request, "portal")
    assert created
    assert create_case(conn, request, "portal") == (case_id, False)

    changed = request.model_copy(update={"requested_by": "someone else"})
    with pytest.raises(DuplicateRequest):
        create_case(conn, changed, "portal")

    row = conn.execute(
        "select status, due_at - received_at as window from app.cases where case_id = %s",
        (case_id,),
    ).fetchone()
    assert row["status"] == "received"
    assert row["window"].total_seconds() == 72 * 3600
    docs = conn.execute(
        "select doc_id, text from app.documents where case_id = %s order by doc_id", (case_id,)
    ).fetchall()
    assert [(d["doc_id"], d["text"]) for d in docs] == sorted(
        (d.doc_id, d.text) for d in request.documents
    )
    conn.commit()


def test_status_moves_only_along_allowed_transitions(conn):
    request = next(c.request for c in CASES if c.request.urgency == "standard")
    case_id, _ = create_case(conn, request, "portal")
    conn.commit()

    with pytest.raises(
        psycopg.errors.RaiseException, match="cannot move from received to approved"
    ):
        set_status(conn, case_id, "approved", "nurse@test", {})
    conn.rollback()

    for status in ("queued", "in_review", "awaiting_nurse", "referred", "denied"):
        set_status(conn, case_id, status, "system:test", {})
    conn.commit()
    actions = conn.execute(
        "select action, detail->>'from' as from_status from audit.events"
        " where target_type = 'case' and target_id = %s order by event_id",
        (str(case_id),),
    ).fetchall()
    assert [a["action"] for a in actions] == [
        "case.received",
        "case.queued",
        "case.in_review",
        "case.awaiting_nurse",
        "case.referred",
        "case.denied",
    ]
    with pytest.raises(psycopg.errors.RaiseException, match="cannot move from denied"):
        set_status(conn, case_id, "queued", "system:test", {})
    conn.rollback()
