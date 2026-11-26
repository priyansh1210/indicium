"""Managing people and API keys (the admin role).

Staff accounts are invited, never self-registered: an admin names the person and their role, and
the person chooses their own password from the emailed link. Nobody can lock themselves out: an
admin cannot deactivate or demote their own account.
"""

from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from indicium.api.account import send_invite, send_reset
from indicium.api.auth import Manager
from indicium.api.users import STAFF_ROLES, create_api_key
from indicium.db import Db, audit

router = APIRouter(tags=["people"])

StaffRole = Literal["viewer", "nurse", "physician", "supervisor", "admin"]
assert set(StaffRole.__args__) == STAFF_ROLES  # one list of roles, checked at import


@router.get("/users")
def list_users(principal: Manager, db: Db) -> list[dict]:
    return db.execute(
        "select u.user_id, u.email, u.name, u.role, u.active, u.created_at, u.last_login_at,"
        " u.totp_secret is not null as mfa_enabled, o.name as practice,"
        " case when not active then 'deactivated'"
        "   when password_hash is null then 'invited'"
        "   when email_verified_at is null then 'unverified' else 'active' end as state"
        " from app.users u left join app.organizations o using (organization_id)"
        " order by u.active desc, o.name nulls first, u.name"
    ).fetchall()


class Invite(BaseModel):
    email: str = Field(min_length=3, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    name: str = Field(min_length=1, max_length=200, pattern=r"\S")  # not only spaces
    role: StaffRole


@router.post("/users", status_code=201)
def invite(body: Invite, principal: Manager, db: Db) -> dict:
    """Invite a person. They get an email with a link to choose their password; the link is also
    returned once, for when email is slow to arrive."""
    email = body.email.strip().lower()
    row = db.execute(
        "insert into app.users (email, name, role) values (%s, %s, %s)"
        " on conflict (email) do nothing returning user_id, email, name, role",
        (email, body.name.strip(), body.role),
    ).fetchone()
    if not row:
        raise HTTPException(409, "Someone with that email already has an account")
    audit(db, principal.actor, "user.invited", "user", row["user_id"], {"role": body.role})
    return {"user_id": row["user_id"], "link": send_invite(db, row, principal.actor)}


class UserChange(BaseModel):
    role: StaffRole | None = None
    active: bool | None = None


@router.patch("/users/{user_id}")
def change_user(user_id: int, body: UserChange, principal: Manager, db: Db) -> dict:
    user = db.execute(
        "select user_id, role, active from app.users where user_id = %s for update", (user_id,)
    ).fetchone()
    if not user:
        raise HTTPException(404, "No such person")
    if user_id == principal.user_id:
        raise HTTPException(409, "You cannot change your own role or deactivate yourself")
    if user["role"] == "provider" and body.role not in (None, "provider"):
        raise HTTPException(409, "A practice's people keep the provider role; deactivate instead")
    changes = {k: v for k, v in body.model_dump().items() if v is not None and v != user[k]}
    if not changes:
        return {"user_id": user_id, "changed": {}}
    db.execute(
        "update app.users set role = coalesce(%s, role), active = coalesce(%s, active)"
        " where user_id = %s",
        (changes.get("role"), changes.get("active"), user_id),
    )
    if changes.get("active") is False or "role" in changes:  # takes effect now, not at expiry
        db.execute("delete from app.sessions where user_id = %s", (user_id,))
    audit(
        db,
        principal.actor,
        "user.changed",
        "user",
        user_id,
        {k: {"from": user[k], "to": v} for k, v in changes.items()},
    )
    return {"user_id": user_id, "changed": changes}


@router.post("/users/{user_id}/link")
def new_link(user_id: int, principal: Manager, db: Db) -> dict:
    """Send a fresh invitation (not accepted yet) or a password reset link (everyone else)."""
    user = db.execute(
        "select user_id, email, name, role, password_hash is null as invited from app.users"
        " where user_id = %s and active",
        (user_id,),
    ).fetchone()
    if not user:
        raise HTTPException(404, "No such active person")
    send = send_invite if user["invited"] else send_reset
    url = send(db, user, principal.actor)
    kind = "invite" if user["invited"] else "reset"
    audit(db, principal.actor, f"user.{kind}_link_sent", "user", user_id)
    return {"kind": kind, "link": url}


@router.get("/api-keys")
def list_keys(principal: Manager, db: Db) -> list[dict]:
    return db.execute(
        "select k.key_id, k.name, k.created_by, k.created_at, k.revoked_at,"
        " coalesce(c.n, 0) as cases_submitted from app.api_keys k"
        " left join (select created_by, count(*) as n from app.cases"
        "   where created_by like 'api-key:%%' group by created_by) c"
        "   on c.created_by = 'api-key:' || k.name"
        " order by k.revoked_at nulls first, k.created_at desc"
    ).fetchall()


class KeyIn(BaseModel):
    name: str = Field(min_length=3, max_length=80, pattern=r"^[a-z0-9][a-z0-9-]*$")


@router.post("/api-keys", status_code=201)
def new_key(body: KeyIn, principal: Manager, db: Db) -> dict:
    """A key for one submitting system. It is shown once; only its hash is kept."""
    if db.execute("select 1 from app.api_keys where name = %s", (body.name,)).fetchone():
        raise HTTPException(409, "A key with that name exists (names stay taken after revoking)")
    return {"name": body.name, "key": create_api_key(db, body.name, principal.actor)}


@router.post("/api-keys/{key_id}/revoke")
def revoke_key(key_id: int, principal: Manager, db: Db) -> dict:
    row = db.execute(
        "update app.api_keys set revoked_at = now() where key_id = %s and revoked_at is null"
        " returning name",
        (key_id,),
    ).fetchone()
    if not row:
        raise HTTPException(404, "No such key, or it is already revoked")
    audit(db, principal.actor, "api_key.revoked", "api_key", row["name"])
    return {"key_id": key_id, "revoked": True}


@router.get("/audit")
def activity(
    principal: Manager,
    db: Db,
    actor: str | None = None,
    action: str | None = None,
    before: int | None = None,
    limit: int = Query(100, ge=1, le=500),
) -> dict:
    """Everything recorded, newest first: sign-ins, account changes, reviews, decisions.
    Filter by who did it or by the start of the action ("user.", "case.denied")."""
    rows = db.execute(
        "select e.event_id, e.at, e.actor, e.action, e.target_type, e.target_id, e.detail,"
        " u.email as target_label from audit.events e"
        " left join app.users u on e.target_type = 'user' and u.user_id::text = e.target_id"
        " where (%(actor)s::text is null or actor = %(actor)s)"
        " and (%(action)s::text is null or action like %(action)s || '%%')"
        " and (%(before)s::bigint is null or event_id < %(before)s)"
        " order by event_id desc limit %(limit)s",
        {"actor": actor, "action": action, "before": before, "limit": limit},
    ).fetchall()
    return {"events": rows, "next": rows[-1]["event_id"] if len(rows) == limit else None}
