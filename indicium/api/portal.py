"""The provider portal: a practice registers, submits requests and follows its own.

A practice sees what a requester needs, not how the payer reviews: the status in plain words,
what happened when, the documents it sent, and each decision with its reason. The checklist,
the model's output and reviewers' notes stay inside.
"""

from fastapi import APIRouter, HTTPException, Query, Request
from psycopg import Connection
from pydantic import BaseModel, Field

from indicium.api.account import Password, send_invite, send_verification
from indicium.api.auth import Tracker, hash_password
from indicium.db import Db, audit
from indicium.mail import link, queue_email

router = APIRouter(tags=["portal"])

MAX_PRACTICES_PER_ADDRESS_HOUR = 5
MAX_INVITES_PER_PRACTICE_HOUR = 10  # invitations are email we send on a practice's word
EMAIL = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
# The case events a practice is told about, in its words. Everything else is internal.
TIMELINE = {
    "case.received": "Request received",
    "case.documents_added": "Documents added",
    "case.referred": "Sent to a physician reviewer",
    "case.pended": "More information requested",
    "case.approved": "Approved",
    "case.denied": "Denied",
}


def valid_npi(npi: str) -> bool:
    """The NPI check digit: Luhn over the number prefixed with 80840 (CMS NPI standard)."""
    if not (len(npi) == 10 and npi.isdigit()):
        return False
    total = 0
    for i, char in enumerate(reversed("80840" + npi[:9])):
        digit = int(char) * (2 if i % 2 == 0 else 1)
        total += digit - 9 if digit > 9 else digit
    return (10 - total % 10) % 10 == int(npi[9])


class Registration(BaseModel):
    practice: str = Field(min_length=2, max_length=200, pattern=r"\S")
    npi: str = Field(pattern=r"^[0-9]{10}$")
    name: str = Field(min_length=1, max_length=200, pattern=r"\S")
    email: str = Field(max_length=320, pattern=EMAIL)
    password: Password


@router.post("/auth/register", status_code=202)
def register(body: Registration, request: Request, db: Db) -> dict:
    """A practice signs up. Its first person confirms their email address before signing in."""
    if not valid_npi(body.npi):
        raise HTTPException(422, "That NPI is not valid: its last digit does not check out.")
    ip = request.client.host if request.client else None
    if ip:
        db.execute("select pg_advisory_xact_lock(hashtext('register:' || %s))", (ip,))
        recent = db.execute(
            "select count(*) as n from app.organizations"
            " where created_ip = %s and created_at > now() - interval '1 hour'",
            (ip,),
        ).fetchone()["n"]
        if recent >= MAX_PRACTICES_PER_ADDRESS_HOUR:
            raise HTTPException(429, "Too many registrations from your network. Try later.")
    email = body.email.strip().lower()
    # "on conflict do nothing" instead of checking first: two registrations at once get a clear
    # answer, not a constraint error. A refusal rolls back the whole registration.
    practice = db.execute(
        "insert into app.organizations (name, npi, created_ip) values (%s, %s, %s)"
        " on conflict (npi) do nothing returning organization_id",
        (body.practice.strip(), body.npi, ip),
    ).fetchone()
    if not practice:
        raise HTTPException(
            409, "That practice is already registered. Ask a colleague there to add you."
        )
    organization_id = practice["organization_id"]
    user = db.execute(
        "insert into app.users (email, name, role, password_hash, organization_id)"
        " values (%s, %s, 'provider', %s, %s) on conflict (email) do nothing"
        " returning user_id, email, name, role",
        (email, body.name.strip(), hash_password(body.password), organization_id),
    ).fetchone()
    if not user:
        raise HTTPException(
            409, "That email has an account already. Sign in or reset the password."
        )
    audit(db, email, "practice.registered", "organization", organization_id, {"npi": body.npi})
    send_verification(db, user, email)
    return {"detail": f"Check {email}: we sent a link to confirm the address."}


def _practice_case(db: Connection, case_id: int, principal) -> dict:
    case = db.execute(
        "select c.case_id, c.external_id, c.patient, c.procedure_code, c.diagnosis_codes,"
        " c.urgency, c.status, c.requested_by, c.received_at, c.due_at, s.title as service"
        " from app.cases c left join lateral (select v.title from policy.procedure_codes pc"
        "   join policy.versions v using (version_id)"
        "   where pc.code = c.procedure_code and v.status = 'published' limit 1) s on true"
        " where c.case_id = %s and c.organization_id = %s",
        (case_id, principal.organization_id),
    ).fetchone()
    if not case:  # another practice's case answers exactly like a missing one
        raise HTTPException(404, "No such request")
    return case


@router.get("/portal/requests")
def requests(
    principal: Tracker,
    db: Db,
    before: int | None = None,
    limit: int = Query(50, ge=1, le=200),
) -> dict:
    """The practice's requests, newest first. Page with `before` (the previous page's `next`)."""
    rows = db.execute(
        "select c.case_id, c.external_id, c.patient->>'name' as patient_name, c.procedure_code,"
        " s.title as service, c.urgency, c.status, c.requested_by, c.received_at, c.due_at,"
        " d.outcome, d.reason as decision_reason, d.at as decided_at from app.cases c"
        " left join lateral (select v.title from policy.procedure_codes pc"
        "   join policy.versions v using (version_id)"
        "   where pc.code = c.procedure_code and v.status = 'published' limit 1) s on true"
        " left join lateral (select outcome, reason, at from app.decisions"
        "   where case_id = c.case_id and outcome <> 'referred'"
        "   order by decision_id desc limit 1) d on true"
        " where c.organization_id = %(org)s"
        " and (%(before)s::bigint is null or c.case_id < %(before)s)"
        " order by c.case_id desc limit %(limit)s",
        {"org": principal.organization_id, "before": before, "limit": limit},
    ).fetchall()
    return {"requests": rows, "next": rows[-1]["case_id"] if len(rows) == limit else None}


@router.get("/portal/requests/{case_id}")
def request_detail(case_id: int, principal: Tracker, db: Db) -> dict:
    case = _practice_case(db, case_id, principal)
    documents = db.execute(
        "select doc_id, kind, author, written_on, length(text) as characters"
        " from app.documents where case_id = %s order by written_on nulls last, doc_id",
        (case_id,),
    ).fetchall()
    decisions = db.execute(
        "select outcome, reason, role, at from app.decisions"
        " where case_id = %s and outcome <> 'referred' order by decision_id",
        (case_id,),
    ).fetchall()
    events = db.execute(
        "select action, at from audit.events where target_type = 'case' and target_id = %s"
        " and action = any(%s) order by event_id",
        (str(case_id), list(TIMELINE)),
    ).fetchall()
    return {
        "case": case,
        "documents": documents,
        "decisions": decisions,
        "timeline": [{"what": TIMELINE[e["action"]], "at": e["at"]} for e in events],
    }


@router.get("/portal/services")
def services(principal: Tracker, db: Db) -> list[dict]:
    """The procedure codes with a published coverage policy, for the request form."""
    return db.execute(
        "select pc.code, v.title from policy.procedure_codes pc join policy.versions v"
        " using (version_id) where v.status = 'published' order by v.title, pc.code"
    ).fetchall()


@router.get("/portal/team")
def team(principal: Tracker, db: Db) -> dict:
    practice = db.execute(
        "select name, npi from app.organizations where organization_id = %s",
        (principal.organization_id,),
    ).fetchone()
    people = db.execute(
        "select user_id, name, email, last_login_at, password_hash is null as invited"
        " from app.users where organization_id = %s and active order by name",
        (principal.organization_id,),
    ).fetchall()
    return {"practice": practice, "people": people}


class Colleague(BaseModel):
    name: str = Field(min_length=1, max_length=200, pattern=r"\S")
    email: str = Field(max_length=320, pattern=EMAIL)


@router.post("/portal/team", status_code=201)
def add_colleague(body: Colleague, principal: Tracker, db: Db) -> dict:
    """Invite someone at the same practice. They choose their password from the emailed link."""
    org = principal.organization_id
    db.execute("select pg_advisory_xact_lock(hashtext('team:' || %s))", (str(org),))
    recent = db.execute(
        "select count(*) as n from app.users where organization_id = %s"
        " and created_at > now() - interval '1 hour'",
        (org,),
    ).fetchone()["n"]
    if recent >= MAX_INVITES_PER_PRACTICE_HOUR:
        raise HTTPException(429, "That is a lot of invitations in one hour. Try again later.")
    row = db.execute(
        "insert into app.users (email, name, role, organization_id)"
        " values (%s, %s, 'provider', %s) on conflict (email) do nothing"
        " returning user_id, email, name, role",
        (body.email.strip().lower(), body.name.strip(), principal.organization_id),
    ).fetchone()
    if not row:
        raise HTTPException(409, "Someone with that email already has an account")
    audit(db, principal.actor, "user.invited", "user", row["user_id"], {"role": "provider"})
    send_invite(db, row, principal.actor)
    return {"user_id": row["user_id"]}


OUTCOME_WORDS = {
    "approved": "approved",
    "denied": "denied",
    "pended": "pended: more information is needed",
}


def notify_practice(db: Connection, case_id: int, outcome: str, reason: str) -> None:
    """Email the practice's people about a decision, in the same transaction as the decision."""
    if outcome not in OUTCOME_WORDS:
        return
    case = db.execute(
        "select external_id, organization_id, patient->>'name' as patient from app.cases"
        " where case_id = %s",
        (case_id,),
    ).fetchone()
    if not case["organization_id"]:
        return
    people = db.execute(
        "select email, name from app.users where organization_id = %s and active"
        " and email_verified_at is not null",
        (case["organization_id"],),
    ).fetchall()
    for person in people:
        queue_email(
            db,
            person["email"],
            f"Prior authorization {case['external_id']}: {outcome}",
            f"Hello {person['name']},\n\nThe request for {case['patient']} "
            f"({case['external_id']}) was {OUTCOME_WORDS[outcome]}.\n\nReason given:\n{reason}\n\n"
            f"Details and, if needed, a place to send more documents:\n"
            f"{link(f'/portal/requests/{case_id}')}\n",
        )
