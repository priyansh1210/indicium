"""The supervisor's view: the queue now, decisions over a period, agreement with the
recommendation, each reviewer's load, and how the automated review is doing.

Everything is computed from the tables the work already writes (cases, decisions, review runs);
nothing is stored for the dashboard, so it can never disagree with the cases themselves.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from indicium.api.auth import Principal, require
from indicium.db import Db

router = APIRouter(tags=["dashboard"])
Overseer = Annotated[Principal, Depends(require("oversee"))]
# The outcome each recommendation points to, for the agreement figure.
MATCH = {"meets_criteria": "approved", "pend_for_info": "pended", "refer_to_clinician": "referred"}


@router.get("/dashboard")
def dashboard(principal: Overseer, db: Db, days: Annotated[int, Query(ge=1, le=365)] = 30) -> dict:
    # Every panel covers the same whole calendar days, today included.
    # shortcut: days follow the database time zone (UTC), add an organisation time zone when
    # reviewers span zones.
    since = db.execute(
        "select (current_date - %(days)s + 1)::timestamptz as since", {"days": days}
    ).fetchone()
    queue = db.execute(
        "select count(*) filter (where status not in ('approved', 'denied')) as open,"
        " count(*) filter (where status not in ('approved', 'denied') and due_at < now())"
        "   as overdue,"
        " count(*) filter (where status not in ('approved', 'denied') and due_at >= now()"
        "   and due_at < now() + interval '24 hours') as due_soon,"
        " count(*) filter (where status not in ('approved', 'denied') and assigned_to is null)"
        "   as unassigned"
        " from app.cases"
    ).fetchone()
    stages = db.execute(
        "select status, count(*) as n from app.cases"
        " where status not in ('approved', 'denied') group by status"
    ).fetchall()
    per_day = db.execute(
        "select d.day::date as day, o.outcome, count(x.decision_id) as n"
        " from generate_series(%(since)s::date, current_date, interval '1 day') as d(day)"
        " cross join (values ('approved'), ('pended'), ('referred'), ('denied')) as o(outcome)"
        " left join (select decision_id, outcome, at::date as day from app.decisions"
        "   where at >= %(since)s) x on x.day = d.day::date and x.outcome = o.outcome"
        " group by 1, 2 order by 1",
        since,
    ).fetchall()
    # A case counts once, at its first decision that answers the request (referral is not one).
    timeliness = db.execute(
        "with first as (select distinct on (d.case_id) d.at, c.received_at, c.due_at"
        "   from app.decisions d join app.cases c using (case_id)"
        "   where d.outcome in ('approved', 'denied', 'pended') and d.case_id in"
        "     (select case_id from app.decisions where at >= %(since)s)"
        "   order by d.case_id, d.decision_id)"
        " select count(*) as decided, count(*) filter (where at <= due_at) as on_time,"
        " percentile_cont(0.5) within group"
        "   (order by extract(epoch from at - received_at) / 3600) as median_hours"
        " from first where at >= %(since)s",
        since,
    ).fetchone()
    agreement = db.execute(
        "select recommendation, outcome, count(*) as n from app.decisions"
        " where recommendation is not null and at >= %(since)s group by 1, 2",
        since,
    ).fetchall()
    reviewers = db.execute(
        "select u.user_id, u.name, u.role,"
        " (select count(*) from app.cases c where c.assigned_to = u.user_id"
        "   and c.status not in ('approved', 'denied')) as open_cases,"
        " count(d.decision_id) as decisions,"
        " count(d.decision_id) filter (where d.against_recommendation) as against,"
        " count(d.decision_id) filter (where d.outcome = 'denied') as denied"
        " from app.users u left join app.decisions d on d.user_id = u.user_id"
        "   and d.at >= %(since)s"
        " where u.active and u.role in ('nurse', 'physician')"
        " group by u.user_id order by decisions desc, u.name",
        since,
    ).fetchall()
    engine = db.execute(
        "select count(*) filter (where status = 'done') as done,"
        " count(*) filter (where status = 'failed') as failed,"
        " count(*) filter (where status in ('queued', 'running')) as waiting,"
        " count(*) filter (where status = 'done' and cardinality(flags) > 0) as flagged,"
        " percentile_cont(0.5) within group (order by latency_ms)"
        "   filter (where status = 'done') as median_ms,"
        " coalesce(sum(tokens_in + tokens_out), 0) as tokens"
        # Waiting runs count however old they are; the rest only within the period.
        " from review.runs where created_at >= %(since)s or status in ('queued', 'running')",
        since,
    ).fetchone()
    matched = sum(r["n"] for r in agreement if MATCH.get(r["recommendation"]) == r["outcome"])
    total = sum(r["n"] for r in agreement)
    return {
        "days": days,
        "queue": queue,
        "stages": {r["status"]: r["n"] for r in stages},
        "per_day": per_day,
        "timeliness": timeliness,
        "agreement": {"cells": agreement, "matched": matched, "total": total},
        "reviewers": reviewers,
        "engine": engine,
    }
