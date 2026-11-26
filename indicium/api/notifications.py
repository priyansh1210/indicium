"""In-app notifications: a case handed to you, documents arriving on a case you hold or decided,
a deadline within a day, and (for a practice) a decision on its request.

Each is written in the same transaction as the change that causes it, except the deadline,
which the worker's sweep notices. A person reads and clears only their own.
"""

from typing import Annotated

from fastapi import APIRouter, Body
from psycopg import Connection

from indicium.api.auth import Person
from indicium.db import Db

router = APIRouter(prefix="/notifications", tags=["notifications"])
KEEP_READ_DAYS = 90


def notify(db: Connection, user_ids: list[int], kind: str, case_id: int) -> None:
    for user_id in dict.fromkeys(user_ids):  # once each, in order
        db.execute(
            "insert into app.notifications (user_id, kind, case_id) values (%s, %s, %s)",
            (user_id, kind, case_id),
        )


def sweep(db: Connection) -> int:
    """Tell each reviewer once about a case of theirs due within a day; forget old read ones.
    Safe to run from any number of workers at once: the unique index keeps one per case."""
    added = db.execute(
        "insert into app.notifications (user_id, kind, case_id)"
        " select assigned_to, 'due_soon', case_id from app.cases"
        " where assigned_to is not null and status in ('awaiting_nurse', 'referred')"
        "   and due_at < now() + interval '24 hours'"
        " on conflict (user_id, case_id) where kind = 'due_soon' do nothing"
    ).rowcount
    db.execute(
        "delete from app.notifications where read_at < now() - make_interval(days => %s)",
        (KEEP_READ_DAYS,),
    )
    return added


@router.get("")
def inbox(principal: Person, db: Db) -> dict:
    items = db.execute(
        "select n.notification_id, n.kind, n.case_id, n.created_at, n.read_at,"
        " c.external_id, c.patient->>'name' as patient, c.procedure_code, c.status, c.due_at"
        " from app.notifications n join app.cases c using (case_id)"
        " where n.user_id = %s order by n.notification_id desc limit 50",
        (principal.user_id,),
    ).fetchall()
    return {"unread": _unread(db, principal.user_id), "items": items}


@router.get("/unread")
def unread(principal: Person, db: Db) -> dict:
    return {"unread": _unread(db, principal.user_id)}


@router.post("/read")
def mark_read(
    principal: Person, db: Db, notification_id: Annotated[int | None, Body(embed=True)] = None
) -> dict:
    """Mark one notification read, or all of them when none is named."""
    db.execute(
        "update app.notifications set read_at = now() where user_id = %s and read_at is null"
        " and (%s::bigint is null or notification_id = %s)",
        (principal.user_id, notification_id, notification_id),
    )
    return {"unread": _unread(db, principal.user_id)}


def _unread(db: Connection, user_id: int) -> int:
    return db.execute(
        "select count(*) as n from app.notifications where user_id = %s and read_at is null",
        (user_id,),
    ).fetchone()["n"]
