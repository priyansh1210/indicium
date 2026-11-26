"""Case routes: intake, the worklist, one case's checklist, corrections, decisions, audit trail."""

from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Body, HTTPException, Query, Response
from fastapi.exceptions import RequestValidationError
from psycopg import Connection, sql
from pydantic import BaseModel, Field, ValidationError

from indicium.api.auth import Decider, Principal, Reader, Reviewer, Submitter
from indicium.api.portal import notify_practice
from indicium.cases.fhir import FhirError, request_from_bundle
from indicium.cases.model import CaseRequest, ClinicalDocument
from indicium.cases.store import DuplicateRequest, add_documents, create_case, set_status
from indicium.config import settings
from indicium.db import Db, audit
from indicium.policies.model import Criterion, Group
from indicium.policies.store import load_version, published_for_code
from indicium.review.rules import Decision, with_overrides
from indicium.review.worker import enqueue

router = APIRouter(prefix="/cases", tags=["cases"])


class Submitted(BaseModel):
    case_id: int
    created: bool
    status: str


def _intake(db: Connection, request: CaseRequest, principal: Principal, response: Response):
    try:
        case_id, created = create_case(db, request, principal.actor, principal.organization_id)
    except DuplicateRequest as error:
        raise HTTPException(409, str(error)) from error
    if created:  # queued in the same transaction, so no case is ever left unreviewed
        enqueue(db, case_id, principal.actor)
    else:
        _check_owner(db, case_id, principal, status=409)
        response.status_code = 200
    status = db.execute("select status from app.cases where case_id = %s", (case_id,)).fetchone()
    return Submitted(case_id=case_id, created=created, status=status["status"])


def _check_owner(db: Connection, case_id: int, principal: Principal, status: int) -> None:
    """An API key (one submitting system) may act only on the cases it submitted, and a practice
    only on its own. Anything else answers as if the case did not exist (404) or the id were
    taken (409): no probing of ids."""
    if principal.kind != "api_key" and principal.role != "provider":
        return
    owner = db.execute(
        "select created_by, organization_id from app.cases where case_id = %s", (case_id,)
    ).fetchone()
    mine = owner is not None and (
        owner["organization_id"] == principal.organization_id
        if principal.role == "provider"
        else owner["created_by"] == principal.actor
    )
    if not mine:
        if status == 404:
            raise HTTPException(404, "No such case")
        raise HTTPException(409, "That external id is already used by another submitter")


@router.post("", status_code=201)
def submit(request: CaseRequest, principal: Submitter, db: Db, response: Response) -> Submitted:
    """Submit a request. Sending the same external_id and content again returns the first case."""
    return _intake(db, request, principal, response)


@router.post("/fhir", status_code=201)
def submit_fhir(
    principal: Submitter, db: Db, response: Response, bundle: Annotated[dict, Body()]
) -> Submitted:
    """Submit a FHIR R4 Bundle: Patient, ServiceRequest, Condition, DocumentReference."""
    try:
        request = request_from_bundle(bundle)
    except FhirError as error:
        raise HTTPException(422, str(error)) from error
    except ValidationError as error:
        raise RequestValidationError(error.errors()) from error
    return _intake(db, request, principal, response)


@router.get("/summary")
def summary(principal: Reader, db: Db) -> dict:
    """How many cases are in each status, how many open ones are past their deadline, and how
    many open ones are assigned to the person asking."""
    counts = db.execute("select status, count(*) as n from app.cases group by status").fetchall()
    totals = db.execute(
        "select count(*) filter (where due_at < now()) as overdue,"
        " count(*) filter (where assigned_to = %s) as mine"
        " from app.cases where status not in ('approved', 'denied')",
        (principal.user_id,),
    ).fetchone()
    return {"by_status": {r["status"]: r["n"] for r in counts}, **totals}


@router.get("/reviewers")
def reviewers(principal: Reader, db: Db) -> list[dict]:
    """People who can be given cases, with how many open cases each holds (their workload)."""
    if "assign" not in principal.permissions:
        raise HTTPException(403, f"Your role ({principal.role}) cannot do this")
    return db.execute(
        "select u.user_id, u.name, u.role, count(c.case_id) as open_cases,"
        " count(c.case_id) filter (where c.due_at < now() + interval '24 hours') as due_soon"
        " from app.users u left join app.cases c on c.assigned_to = u.user_id"
        "   and c.status not in ('approved', 'denied')"
        " where u.active and u.role in ('nurse', 'physician')"
        " group by u.user_id order by u.role, u.name"
    ).fetchall()


# Each sort: the order, and the keyset condition that continues after the previous page's last
# row. The cursor carries that row's sort value and case id.
SORTS = {
    "due": (
        sql.SQL("c.due_at, c.case_id"),
        sql.SQL("(c.due_at, c.case_id) > (%(at)s, %(id)s)"),
        "due_at",
    ),
    "received": (
        sql.SQL("c.received_at desc, c.case_id desc"),
        sql.SQL("(c.received_at, c.case_id) < (%(at)s, %(id)s)"),
        "received_at",
    ),
}
WORKLIST = sql.SQL(
    "select c.case_id, c.external_id, c.patient->>'name' as patient_name, c.procedure_code,"
    " c.urgency, c.status, c.requested_by, c.received_at, c.due_at,"
    " c.due_at < now() as overdue, c.assigned_to, a.name as assigned_name,"
    " r.run_id, r.recommendation, r.flags, v.title as policy_title"
    " from app.cases c"
    " left join app.users a on a.user_id = c.assigned_to"
    " left join lateral (select * from review.runs where case_id = c.case_id"
    "   and status = 'done' order by run_id desc limit 1) r on true"
    " left join policy.versions v on v.version_id = r.policy_version_id"
    " where (%(status)s::text[] is null or c.status = any(%(status)s))"
    " and (%(urgency)s::text is null or c.urgency = %(urgency)s)"
    # shortcut: search scans the open cases with ilike; add a pg_trgm index when the table
    # holds hundreds of thousands of cases.
    " and (%(q)s::text is null or c.case_id::text = %(q)s or c.external_id ilike %(like)s"
    "   or c.patient->>'name' ilike %(like)s or c.patient->>'member_id' ilike %(like)s"
    "   or c.procedure_code ilike %(like)s or v.title ilike %(like)s)"
    " and (%(assignee)s::bigint is null or c.assigned_to = %(assignee)s)"
    " and (not %(unassigned)s or c.assigned_to is null)"
    " and (not %(flagged)s or cardinality(r.flags) > 0)"
    " and (%(within)s::int is null or c.due_at < now() + make_interval(hours => %(within)s))"
    " and (%(at)s::timestamptz is null or {after})"
    " order by {order} limit %(limit)s"
)


@router.get("")
def worklist(
    principal: Reader,
    db: Db,
    status: Annotated[list[str] | None, Query()] = None,
    urgency: Literal["standard", "expedited"] | None = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    assigned: Annotated[str | None, Query(pattern=r"^(me|none|[0-9]+)$")] = None,
    flagged: bool = False,
    due_within_hours: Annotated[int | None, Query(ge=1, le=24 * 30)] = None,
    sort: Literal["due", "received"] = "due",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    after: str | None = None,
) -> dict:
    """Open work, filtered and sorted: soonest deadline first by default, or newest first.
    Page with `after` (the previous page's `next`)."""
    order, after_sql, key = SORTS[sort]
    cursor_at, cursor_id = _cursor(after)
    q = (q or "").strip() or None
    like = None if q is None else _like(q)
    rows = db.execute(
        WORKLIST.format(after=after_sql, order=order),
        {
            "status": status,
            "urgency": urgency,
            "q": q,
            "like": like,
            "assignee": principal.user_id if assigned == "me" else _int_or_none(assigned),
            "unassigned": assigned == "none",
            "flagged": flagged,
            "within": due_within_hours,
            "at": cursor_at,
            "id": cursor_id,
            "limit": limit,
        },
    ).fetchall()
    last = rows[-1] if len(rows) == limit else None
    return {
        "cases": rows,
        "next": f"{last[key].isoformat()}|{last['case_id']}" if last else None,
    }


def _like(text: str) -> str:
    """An ilike pattern that finds the text anywhere, with % and _ taken literally."""
    for char in ("\\", "%", "_"):
        text = text.replace(char, "\\" + char)
    return f"%{text}%"


def _int_or_none(value: str | None) -> int | None:
    return int(value) if value and value.isdigit() else None


def _cursor(after: str | None) -> tuple[datetime | None, int | None]:
    if not after:
        return None, None
    try:
        at, _, case_id = after.rpartition("|")
        return datetime.fromisoformat(at), int(case_id)
    except ValueError as error:
        raise HTTPException(400, "Invalid page cursor") from error


def _state(db: Connection, case_id: int, lock: bool = False) -> dict[str, Any]:
    """Everything about a case's latest review that a decision depends on."""
    query = "select * from app.cases where case_id = %s"
    case = db.execute(f"{query} for update" if lock else query, (case_id,)).fetchone()
    if not case:
        raise HTTPException(404, "No such case")
    run = db.execute(
        "select * from review.runs where case_id = %s and status = 'done'"
        " order by run_id desc limit 1",
        (case_id,),
    ).fetchone()
    findings, overrides, policy, effective = [], {}, None, None
    if run:
        findings = db.execute(
            "select criterion_id, finding, confidence, rationale, evidence, dropped"
            " from review.findings where run_id = %s",
            (run["run_id"],),
        ).fetchall()
        overrides = {
            o["criterion_id"]: o
            for o in db.execute(
                "select distinct on (criterion_id) o.criterion_id, o.finding, o.reason, o.at,"
                " u.name as by_name, u.email as by_email from review.overrides o"
                " join app.users u using (user_id) where o.run_id = %s"
                " order by criterion_id, override_id desc",
                (run["run_id"],),
            ).fetchall()
        }
        if run["policy_version_id"]:
            policy = load_version(db, run["policy_version_id"])
            has_documents = bool(
                db.execute(
                    "select 1 from app.documents where case_id = %s limit 1", (case_id,)
                ).fetchone()
            )
            effective = with_overrides(
                policy,
                findings,
                {k: v["finding"] for k, v in overrides.items()},
                set(run["flags"] or []),
                has_documents,
                settings().min_confidence,
            )
        else:
            effective = Decision(run["recommendation"], run["reasons"])
    return {
        "case": case,
        "run": run,
        "findings": findings,
        "overrides": overrides,
        "policy": policy,
        "effective": effective,
    }


@router.get("/{case_id}")
def detail(case_id: int, principal: Reader, db: Db) -> dict:
    state = _state(db, case_id)
    run, policy = state["run"], state["policy"]
    documents = db.execute(
        "select doc_id, kind, author, written_on, text from app.documents where case_id = %s"
        " order by written_on nulls last, doc_id",
        (case_id,),
    ).fetchall()
    runs = db.execute(
        "select run_id, status, attempts, provider, model, prompt_version, policy_version_id,"
        " recommendation, flags, created_at, finished_at, latency_ms, tokens_in, tokens_out,"
        " error from review.runs where case_id = %s order by run_id desc",
        (case_id,),
    ).fetchall()
    decisions = db.execute(
        "select d.decision_id, d.outcome, d.reason, d.recommendation, d.against_recommendation,"
        " d.role, d.at, u.name as by_name from app.decisions d join app.users u using (user_id)"
        " where d.case_id = %s order by decision_id",
        (case_id,),
    ).fetchall()
    if policy is None:  # no finished review yet: show the policy that will be used
        matches = published_for_code(db, state["case"]["procedure_code"])
        policy = load_version(db, matches[0]["version_id"]) if len(matches) == 1 else None
    assignee = db.execute(
        "select user_id, name, role from app.users where user_id = %s",
        (state["case"]["assigned_to"],),
    ).fetchone()
    by_id = {f["criterion_id"]: f for f in state["findings"]}
    effective = state["effective"]
    return {
        "case": state["case"],
        "documents": documents,
        "policy": None
        if policy is None
        else {
            "policy_id": policy.policy_id,
            "title": policy.title,
            "source": policy.source.model_dump(mode="json"),
        },
        "checklist": _checklist(policy.criteria, by_id, state["overrides"]) if policy else None,
        "review": None
        if run is None
        else {
            "run_id": run["run_id"],
            "recommendation": effective.recommendation,
            "reasons": effective.reasons,
            "model_recommendation": run["recommendation"],
            "flags": run["flags"],
            "injection_hits": (run["detail"] or {}).get("injection_hits", []),
            "concerns": (run["detail"] or {}).get("concerns", []),
            "provider": run["provider"],
            "model": run["model"],
            "prompt_version": run["prompt_version"],
            "finished_at": run["finished_at"],
        },
        "runs": runs,
        "assignee": assignee,
        "decisions": decisions,
    }


def _checklist(node: Group | Criterion, findings: dict, overrides: dict) -> dict:
    """The policy tree, each criterion with what the review found and any correction."""
    if isinstance(node, Group):
        return {
            "type": "group",
            "op": node.op,
            "n": node.n,
            "label": node.label,
            "items": [_checklist(i, findings, overrides) for i in node.items],
        }
    found = findings.get(node.id) or {}
    override = overrides.get(node.id)
    return {
        "type": "criterion",
        "id": node.id,
        "kind": node.kind,
        "text": node.text,
        "guidance": node.guidance,
        "source_quote": node.source_quote,
        "finding": found.get("finding"),
        "confidence": found.get("confidence"),
        "rationale": found.get("rationale"),
        "evidence": found.get("evidence", []),
        "dropped": found.get("dropped", []),
        "override": override,
        "effective": override["finding"] if override else found.get("finding"),
    }


class OverrideIn(BaseModel):
    run_id: int
    finding: Literal["documented", "contradicted", "absent"]
    reason: str = Field(min_length=3, max_length=2000)


EDITABLE = {"awaiting_nurse", "referred"}


@router.post("/{case_id}/checklist/{criterion_id}")
def override(
    case_id: int, criterion_id: str, body: OverrideIn, principal: Reviewer, db: Db
) -> dict:
    """Correct one checklist item. The reason is kept with it; nothing is overwritten."""
    state = _state(db, case_id, lock=True)
    _check_current(state, body.run_id)
    if state["case"]["status"] not in EDITABLE:
        raise HTTPException(409, f"A case that is {state['case']['status']} cannot be edited")
    before = next((f for f in state["findings"] if f["criterion_id"] == criterion_id), None)
    if before is None:
        raise HTTPException(404, "That item is not on this case's checklist")
    db.execute(
        "insert into review.overrides (run_id, criterion_id, finding, reason, user_id)"
        " values (%s, %s, %s, %s, %s)",
        (body.run_id, criterion_id, body.finding, body.reason.strip(), principal.user_id),
    )
    audit(
        db,
        principal.actor,
        "checklist.overridden",
        "case",
        case_id,
        {
            "run_id": body.run_id,
            "criterion_id": criterion_id,
            "from": (state["overrides"].get(criterion_id) or before)["finding"],
            "to": body.finding,
            "reason": body.reason.strip(),
        },
    )
    effective = _state(db, case_id)["effective"]
    return {"recommendation": effective.recommendation, "reasons": effective.reasons}


def _check_current(state: dict, run_id: int) -> None:
    run = state["run"]
    if run is None or run["run_id"] != run_id:
        raise HTTPException(409, "The review has changed since you loaded it; reload the case")


class DecisionIn(BaseModel):
    run_id: int
    outcome: Literal["approved", "pended", "referred", "denied"]
    reason: str = Field(min_length=3, max_length=4000)


# (status, outcome) -> the permission it takes. Anything else is not a valid decision.
DECISIONS = {
    ("awaiting_nurse", "approved"): "decide",
    ("awaiting_nurse", "pended"): "decide",
    ("awaiting_nurse", "referred"): "decide",
    ("referred", "approved"): "decide_referred",
    ("referred", "pended"): "decide_referred",
    ("referred", "denied"): "decide_referred",
}


@router.post("/{case_id}/decision")
def decide(case_id: int, body: DecisionIn, principal: Decider, db: Db) -> dict:
    state = _state(db, case_id, lock=True)
    status = state["case"]["status"]
    needed = DECISIONS.get((status, body.outcome))
    if needed is None:
        raise HTTPException(409, f"A case that is {status} cannot be {body.outcome}")
    if needed not in principal.permissions:
        raise HTTPException(403, "Only a physician reviewer can decide a referred case")
    _check_current(state, body.run_id)
    recommendation = state["effective"].recommendation
    against = (body.outcome == "approved" and recommendation != "meets_criteria") or (
        body.outcome == "denied" and recommendation == "meets_criteria"
    )
    decision_id = db.execute(
        "insert into app.decisions (case_id, run_id, outcome, reason, recommendation,"
        " against_recommendation, user_id, role) values (%s, %s, %s, %s, %s, %s, %s, %s)"
        " returning decision_id",
        (
            case_id,
            body.run_id,
            body.outcome,
            body.reason.strip(),
            recommendation,
            against,
            principal.user_id,
            principal.role,
        ),
    ).fetchone()["decision_id"]
    set_status(
        db,
        case_id,
        body.outcome,
        principal.actor,
        {"decision_id": decision_id, "recommendation": recommendation, "against": against},
    )
    if body.outcome == "referred":  # it moves to the physicians' queue, to whoever takes it
        db.execute("update app.cases set assigned_to = null where case_id = %s", (case_id,))
    notify_practice(db, case_id, body.outcome, body.reason.strip())
    return {"decision_id": decision_id, "status": body.outcome, "against_recommendation": against}


class DocumentsIn(BaseModel):
    documents: list[ClinicalDocument] = Field(min_length=1, max_length=50)


@router.post("/{case_id}/documents", status_code=201)
def attach(case_id: int, body: DocumentsIn, principal: Submitter, db: Db) -> dict:
    """Add documents (for example, the information a pended case asked for) and review again."""
    case = db.execute(
        "select status from app.cases where case_id = %s for update", (case_id,)
    ).fetchone()
    if not case:
        raise HTTPException(404, "No such case")
    _check_owner(db, case_id, principal, status=404)
    if case["status"] not in ("pended", "awaiting_nurse", "failed"):
        raise HTTPException(409, f"Documents cannot be added while the case is {case['status']}")
    try:
        add_documents(db, case_id, body.documents, principal.actor)
    except DuplicateRequest as error:
        raise HTTPException(409, str(error)) from error
    run_id = enqueue(db, case_id, principal.actor)
    return {"run_id": run_id, "status": "queued"}


@router.post("/{case_id}/review", status_code=202)
def rerun(case_id: int, principal: Reader, db: Db) -> dict:
    """Review again: after a failure, or after the policy changed."""
    if not principal.permissions & {"review", "manage"}:
        raise HTTPException(403, f"Your role ({principal.role}) cannot do this")
    case = db.execute(
        "select status from app.cases where case_id = %s for update", (case_id,)
    ).fetchone()
    if not case:
        raise HTTPException(404, "No such case")
    if case["status"] not in ("failed", "awaiting_nurse"):
        raise HTTPException(409, f"A case that is {case['status']} cannot be reviewed again")
    return {"run_id": enqueue(db, case_id, principal.actor), "status": "queued"}


class AssignIn(BaseModel):
    user_id: int | None  # null takes the case off whoever has it


@router.post("/{case_id}/assign")
def assign(case_id: int, body: AssignIn, principal: Reader, db: Db) -> dict:
    """Take a case (a reviewer, for themselves) or hand it to someone (a supervisor)."""
    supervisor = "assign" in principal.permissions
    if not supervisor and "review" not in principal.permissions:
        raise HTTPException(403, f"Your role ({principal.role}) cannot do this")
    case = db.execute(
        "select status, assigned_to from app.cases where case_id = %s for update", (case_id,)
    ).fetchone()
    if not case:
        raise HTTPException(404, "No such case")
    if not supervisor and (
        body.user_id not in (None, principal.user_id)
        or case["assigned_to"] not in (None, principal.user_id)
    ):
        raise HTTPException(403, "You can take or release your own cases; a supervisor reassigns")
    if case["status"] in ("approved", "denied"):
        raise HTTPException(409, "A decided case is not assigned")
    if body.user_id is not None:
        person = db.execute(
            "select role from app.users where user_id = %s and active", (body.user_id,)
        ).fetchone()
        if not person or person["role"] not in ("nurse", "physician"):
            raise HTTPException(409, "Cases go to nurses and physicians")
        if case["status"] == "referred" and person["role"] != "physician":
            raise HTTPException(409, "A referred case goes to a physician")
    db.execute(
        "update app.cases set assigned_to = %s, assigned_at = case when %s::bigint is null"
        " then null else now() end where case_id = %s",
        (body.user_id, body.user_id, case_id),
    )
    audit(
        db,
        principal.actor,
        "case.assigned",
        "case",
        case_id,
        {"from": case["assigned_to"], "to": body.user_id},
    )
    return {"case_id": case_id, "assigned_to": body.user_id}


@router.get("/{case_id}/audit")
def audit_trail(case_id: int, principal: Reader, db: Db) -> list[dict]:
    """Every recorded event for the case and its reviews, oldest first."""
    if not db.execute("select 1 from app.cases where case_id = %s", (case_id,)).fetchone():
        raise HTTPException(404, "No such case")
    return db.execute(
        "select event_id, at, actor, action, target_type, target_id, detail from audit.events"
        " where (target_type = 'case' and target_id = %(id)s)"
        " or (target_type = 'review_run' and target_id in"
        "   (select run_id::text from review.runs where case_id = %(case)s))"
        " order by event_id",
        {"id": str(case_id), "case": case_id},
    ).fetchall()
