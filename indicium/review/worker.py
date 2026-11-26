"""The review worker: claims queued reviews, runs them, stores the outcome.

    python -m indicium.review.worker          run until stopped (SIGTERM/SIGINT finish the job)
    python -m indicium.review.worker --once   run until the queue is empty, then exit

Any number of workers can run. A claim is a lease: if a worker dies, its run is claimed again
when the lease passes. The model call happens outside any transaction, and a result is written
only if the worker still holds the claim (same attempt number), so a slow worker whose lease
was taken over cannot overwrite the newer run.
"""

import argparse
import logging
import signal
import sys
import threading
import time

from psycopg import Connection
from psycopg.types.json import Jsonb

from indicium import observability
from indicium.cases.store import load_request, set_status
from indicium.config import settings
from indicium.db import audit, make_pool
from indicium.mail import run_sender
from indicium.policies.store import load_version, published_for_code
from indicium.review.engine import ReviewOutcome, review
from indicium.review.providers import Provider, provider_from_settings
from indicium.review.rules import Decision

log = logging.getLogger("indicium.worker")
tracer = observability.tracer
ACTOR = "system:review-worker"


def enqueue(conn: Connection, case_id: int, actor: str) -> int:
    """Queue a review of a case. A case already queued or running keeps its run."""
    case = conn.execute(
        "select status, due_at from app.cases where case_id = %s for update", (case_id,)
    ).fetchone()
    if not case:
        raise LookupError(f"case {case_id} does not exist")
    active = conn.execute(
        "select run_id from review.runs where case_id = %s and status in ('queued', 'running')",
        (case_id,),
    ).fetchone()
    if active:
        return active["run_id"]
    run_id = conn.execute(
        "insert into review.runs (case_id, due_at, requested_by) values (%s, %s, %s)"
        " returning run_id",
        (case_id, case["due_at"], actor),
    ).fetchone()["run_id"]
    set_status(conn, case_id, "queued", actor, {"run_id": run_id})
    return run_id


def claim(conn: Connection, lease_seconds: int) -> dict | None:
    """Take the most urgent available run, or one whose worker's lease has passed."""
    run = conn.execute(
        "with next as ("
        "  select run_id from review.runs"
        "  where (status = 'queued' and available_at <= now())"
        "     or (status = 'running' and lease_until < now())"
        "  order by due_at, run_id limit 1 for update skip locked)"
        " update review.runs r set status = 'running', attempts = r.attempts + 1,"
        "   started_at = now(), lease_until = now() + make_interval(secs => %s)"
        " from next where r.run_id = next.run_id returning r.*",
        (lease_seconds,),
    ).fetchone()
    if run:
        status = conn.execute(
            "select status from app.cases where case_id = %s", (run["case_id"],)
        ).fetchone()["status"]
        if status == "queued":  # a run claimed again after a lost lease is already in review
            set_status(conn, run["case_id"], "in_review", ACTOR, {"run_id": run["run_id"]})
    return run


def process(pool, provider: Provider, run: dict) -> None:
    attributes = {"case_id": run["case_id"], "run_id": run["run_id"], "attempt": run["attempts"]}
    with tracer.start_as_current_span("review.run", attributes=attributes):
        _process(pool, provider, run)


def _process(pool, provider: Provider, run: dict) -> None:
    s = settings()
    if run["attempts"] > s.worker_max_attempts:
        with pool.connection() as conn:
            _fail(conn, run, "gave up after repeated lost leases", retry=False)
        return
    started = time.perf_counter()
    try:
        with pool.connection() as conn:  # a short read; the model call below holds no transaction
            request = load_request(conn, run["case_id"])
            matches = published_for_code(conn, request.procedure_code)
            policy = load_version(conn, matches[0]["version_id"]) if len(matches) == 1 else None
        if policy is None:
            outcome, version_id = None, None
        else:
            outcome = review(request, policy, provider, s.min_confidence, s.approval_check)
            version_id = matches[0]["version_id"]
    except Exception as error:
        log.exception("review failed", extra={"case_id": run["case_id"], "run_id": run["run_id"]})
        with pool.connection() as conn:
            _fail(conn, run, f"{type(error).__name__}: {error}"[:2000], retry=True)
        return
    with pool.connection() as conn:
        latency = round((time.perf_counter() - started) * 1000)
        if outcome is None:
            reason = (
                "No published policy covers this procedure code."
                if not matches
                else "More than one published policy covers this procedure code."
            )
            stored = _complete_without_policy(conn, run, reason, latency)
        else:
            stored = _complete(conn, run, outcome, version_id, latency)
        if not stored:
            log.warning("review %s lost its lease; its result was discarded", run["run_id"])


def _complete(conn, run: dict, outcome: ReviewOutcome, version_id: int, latency: int) -> bool:
    result, decision = outcome.result, outcome.decision
    detail = {
        "input_hash": outcome.input_hash,
        "timings_ms": outcome.timings_ms,
        "injection_hits": [vars(h) for h in outcome.injection_hits],
        "concerns": outcome.concerns,
    } | (result.detail if result else {})
    updated = conn.execute(
        "update review.runs set status = 'done', finished_at = now(), lease_until = null,"
        " provider = %s, model = %s, prompt_version = %s, policy_version_id = %s,"
        " recommendation = %s, reasons = %s, flags = %s, tokens_in = %s, tokens_out = %s,"
        " latency_ms = %s, error = null, detail = %s"
        " where run_id = %s and status = 'running' and attempts = %s",
        (
            result.provider if result else None,
            result.model if result else None,
            result.prompt_version if result else None,
            version_id,
            decision.recommendation,
            Jsonb(decision.reasons),
            sorted(outcome.flags),
            result.tokens_in if result else 0,
            result.tokens_out if result else 0,
            latency,
            Jsonb(detail),
            run["run_id"],
            run["attempts"],
        ),
    ).rowcount
    if not updated:
        return False
    with conn.cursor() as cur:
        cur.executemany(
            "insert into review.findings (run_id, criterion_id, finding, confidence, rationale,"
            " evidence, dropped) values (%s, %s, %s, %s, %s, %s, %s)",
            [
                (
                    run["run_id"],
                    f.criterion_id,
                    f.finding,
                    f.confidence,
                    f.rationale,
                    Jsonb(f.evidence),
                    Jsonb(f.dropped),
                )
                for f in outcome.findings
            ],
        )
    _finish(
        conn, run, decision, sorted(outcome.flags), version_id, result.model if result else None
    )
    return True


def _complete_without_policy(conn, run: dict, reason: str, latency: int) -> bool:
    decision = Decision("refer_to_clinician", [reason])
    updated = conn.execute(
        "update review.runs set status = 'done', finished_at = now(), lease_until = null,"
        " recommendation = %s, reasons = %s, flags = %s, latency_ms = %s, error = null"
        " where run_id = %s and status = 'running' and attempts = %s",
        (
            decision.recommendation,
            Jsonb(decision.reasons),
            [],
            latency,
            run["run_id"],
            run["attempts"],
        ),
    ).rowcount
    if updated:
        _finish(conn, run, decision, [], None, None)
    return bool(updated)


def _finish(conn, run: dict, decision: Decision, flags: list[str], version_id, model) -> None:
    detail = {"run_id": run["run_id"], "recommendation": decision.recommendation}
    set_status(conn, run["case_id"], "awaiting_nurse", ACTOR, detail)
    audit(
        conn,
        ACTOR,
        "review.completed",
        "review_run",
        run["run_id"],
        detail | {"flags": flags, "policy_version_id": version_id, "model": model},
    )


def _fail(conn, run: dict, error: str, retry: bool) -> None:
    s = settings()
    again = retry and run["attempts"] < s.worker_max_attempts
    updated = conn.execute(
        "update review.runs set status = %s, error = %s, lease_until = null,"
        " available_at = now() + make_interval(secs => %s),"
        " finished_at = case when %s then null else now() end"
        " where run_id = %s and status = 'running' and attempts = %s",
        (
            "queued" if again else "failed",
            error,
            min(30 * 2 ** run["attempts"], 3600) if again else 0,
            again,
            run["run_id"],
            run["attempts"],
        ),
    ).rowcount
    if not updated:
        return
    set_status(
        conn, run["case_id"], "queued" if again else "failed", ACTOR, {"run_id": run["run_id"]}
    )
    audit(
        conn,
        ACTOR,
        "review.retry_scheduled" if again else "review.failed",
        "review_run",
        run["run_id"],
        {"error": error, "attempt": run["attempts"]},
    )


def run_worker(stop: threading.Event, once: bool = False) -> int:
    """Process runs until stopped (or, with once, until none is available). Returns the count."""
    s = settings()
    provider = provider_from_settings(s)
    done, run = 0, None
    with make_pool() as pool:
        pool.wait()
        while not stop.is_set():
            try:
                with pool.connection() as conn:
                    run = claim(conn, s.worker_lease_seconds)
                if run is not None:
                    process(pool, provider, run)
                    done += 1
                    continue
            except Exception:
                # The database blinked (or recording a failure failed). The run's lease brings it
                # back; this worker keeps going instead of leaving the queue unattended.
                log.exception("worker step failed; retrying shortly")
            if once and run is None:
                break
            stop.wait(s.worker_poll_seconds)
    return done


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m indicium.review.worker")
    parser.add_argument("--once", action="store_true", help="exit when the queue is empty")
    args = parser.parse_args(argv)
    observability.configure("indicium-worker", settings().log_json)
    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())
    if not args.once:  # email rides along on its own thread and connection, so a long review
        # never holds up a password reset, and a mail outage never stops reviews
        mail_pool = make_pool()
        mail_pool.open()
        threading.Thread(target=run_sender, args=(mail_pool, stop), daemon=True).start()
    done = run_worker(stop, once=args.once)
    log.info("processed %s reviews", done)
    return 0


if __name__ == "__main__":
    sys.exit(main())
