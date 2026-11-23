"""The queue and worker against a real database, with a scripted provider."""

from pathlib import Path

import pytest
from psycopg.rows import dict_row

from indicium.cases.dataset import read_cases
from indicium.cases.store import create_case
from indicium.config import settings
from indicium.db import make_pool
from indicium.policies import store as policy_store
from indicium.policies.files import policy_files, read_policy
from indicium.review.providers import ProviderError
from indicium.review.worker import claim, enqueue, process
from tests.test_engine import Scripted, perfect

CASES = {c.case_id: c for c in read_cases(Path("data/cases"))}


@pytest.fixture(scope="module")
def pool(db_url):
    with pytest.MonkeyPatch.context() as env:
        env.setenv("INDICIUM_DATABASE_URL", db_url)
        settings.cache_clear()
        with make_pool() as pool, pool.connection() as conn:
            conn.row_factory = dict_row
            for path in policy_files([Path("data/policies")]):
                version_id, _ = policy_store.save(conn, read_policy(path), "test")
                policy_store.publish(conn, version_id, "test")
            conn.commit()
            yield pool
    settings.cache_clear()


def new_case(pool, case_id: str, **changes) -> int:
    request = CASES[case_id].request.model_copy(update=changes)
    with pool.connection() as conn:
        created, _ = create_case(conn, request, "test")
        enqueue(conn, created, "test")
    return created


def take(pool) -> dict:
    with pool.connection() as conn:
        return claim(conn, lease_seconds=600)


def rows(pool, sql: str, *args) -> list[dict]:
    with pool.connection() as conn:
        return conn.execute(sql, args).fetchall()


def test_a_queued_case_is_reviewed_stored_and_audited(pool):
    case = CASES["lm-01-failed-conservative-care"]
    case_id = new_case(pool, case.case_id)
    with pool.connection() as conn:
        assert enqueue(conn, case_id, "test") == enqueue(conn, case_id, "test")  # one active run
    run = take(pool)
    assert run["case_id"] == case_id
    process(pool, Scripted(perfect(case)), run)

    [done] = rows(pool, "select * from review.runs where run_id = %s", run["run_id"])
    assert (done["status"], done["recommendation"]) == ("done", "meets_criteria")
    assert done["policy_version_id"] and done["detail"]["input_hash"]
    findings = rows(
        pool, "select criterion_id, finding from review.findings where run_id = %s", run["run_id"]
    )
    assert {f["criterion_id"] for f in findings} == set(case.labels)
    [status] = rows(pool, "select status from app.cases where case_id = %s", case_id)
    assert status["status"] == "awaiting_nurse"
    actions = [r["action"] for r in rows(pool, "select action from audit.events order by event_id")]
    assert "review.completed" in actions and "case.in_review" in actions


def test_two_workers_never_take_the_same_run(pool):
    first = new_case(pool, "esi-01-radiculopathy-meets")
    second = new_case(pool, "esi-03-no-baseline-scale")
    with pool.connection() as a, pool.connection() as b:
        run_a, run_b = claim(a, 600), claim(b, 600)  # both transactions still open
    assert {run_a["case_id"], run_b["case_id"]} == {first, second}
    for run in (run_a, run_b):
        process(pool, Scripted(perfect(CASES["esi-01-radiculopathy-meets"])), run)


class Failing:
    def extract(self, task):
        raise ProviderError("model server answered 503")


def test_a_failing_model_is_retried_then_the_case_is_marked_failed(pool):
    case_id = new_case(pool, "tka-01-end-stage-oa")
    for attempt in range(1, settings().worker_max_attempts + 1):
        with pool.connection() as conn:  # make the retry available now instead of after backoff
            conn.execute(
                "update review.runs set available_at = now() where case_id = %s", (case_id,)
            )
        run = take(pool)
        assert (run["case_id"], run["attempts"]) == (case_id, attempt)
        process(pool, Failing(), run)
    [run] = rows(pool, "select status, error from review.runs where case_id = %s", case_id)
    assert run["status"] == "failed" and "503" in run["error"]
    [case] = rows(pool, "select status from app.cases where case_id = %s", case_id)
    assert case["status"] == "failed"


def test_a_worker_that_lost_its_lease_cannot_overwrite_the_new_claim(pool):
    case = CASES["cpap-01-severe-osa"]
    case_id = new_case(pool, case.case_id)
    stale = take(pool)
    with pool.connection() as conn:
        conn.execute(
            "update review.runs set lease_until = now() - interval '1 second' where run_id = %s",
            (stale["run_id"],),
        )
    fresh = take(pool)
    assert (fresh["run_id"], fresh["attempts"]) == (stale["run_id"], 2)

    process(pool, Scripted(perfect(case)), stale)  # the slow first worker finishes late
    [run] = rows(pool, "select status from review.runs where run_id = %s", stale["run_id"])
    assert run["status"] == "running"  # its result was discarded
    process(pool, Scripted(perfect(case)), fresh)
    [run] = rows(pool, "select status from review.runs where run_id = %s", stale["run_id"])
    assert run["status"] == "done"
    assert len(
        rows(pool, "select 1 from review.findings where run_id = %s", stale["run_id"])
    ) == len(case.labels)
    [case_row] = rows(pool, "select status from app.cases where case_id = %s", case_id)
    assert case_row["status"] == "awaiting_nurse"


def test_a_procedure_without_a_policy_goes_to_a_person(pool):
    case_id = new_case(
        pool, "lm-05-therapy-response-unknown", external_id="no-policy-1", procedure_code="99999"
    )
    process(pool, Scripted(perfect(CASES["lm-05-therapy-response-unknown"])), take(pool))
    [run] = rows(
        pool, "select recommendation, reasons from review.runs where case_id = %s", case_id
    )
    assert run["recommendation"] == "refer_to_clinician"
    assert "No published policy" in run["reasons"][0]


def test_a_lease_shorter_than_the_slowest_model_call_is_refused():
    from pydantic import ValidationError

    from indicium.config import Settings

    with pytest.raises(ValidationError, match="must exceed the longest model call"):
        Settings(model_timeout_seconds=120, model_max_retries=3, worker_lease_seconds=900)
    Settings(
        model_timeout_seconds=90,
        model_max_retries=3,
        worker_lease_seconds=900,
        approval_check=False,
    )


def test_the_lease_also_covers_the_approval_check():
    from pydantic import ValidationError

    from indicium.config import Settings

    with pytest.raises(ValidationError, match="must exceed"):
        Settings(model_timeout_seconds=90, model_max_retries=3, worker_lease_seconds=900)
    Settings(
        model_timeout_seconds=90,
        model_max_retries=3,
        worker_lease_seconds=900,
        approval_check=False,
    )
    Settings()  # the defaults are consistent
