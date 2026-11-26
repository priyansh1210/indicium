"""The supervisor dashboard: figures that agree with the cases and decisions behind them."""

from tests import test_api
from tests.test_api import review_queued, submit

world = test_api.world


def test_the_dashboard_counts_the_queue_decisions_and_agreement(api, world):
    pended = submit(world, "lm-06-three-weeks-no-treatment")
    referred = submit(world, "tka-01-end-stage-oa")
    waiting = submit(world, "cpap-01-severe-osa")
    for case_id in (pended, referred):
        review_queued(api, case_id)
    nurse = world["nurse"]
    for case_id, outcome in ((pended, "pended"), (referred, "referred")):
        detail = nurse.get(f"/cases/{case_id}").json()
        body = {"run_id": detail["review"]["run_id"], "outcome": outcome, "reason": "Checked"}
        assert nurse.post(f"/cases/{case_id}/decision", json=body).status_code == 200

    # A decision a minute before the 7-day period starts: no panel may count it.
    with api.app.state.pool.connection() as conn:
        conn.execute(
            "insert into app.decisions"
            " (case_id, outcome, reason, recommendation, user_id, role, at)"
            " select %s, 'approved', 'Old', 'meets_criteria', user_id, role,"
            "   (current_date - 6)::timestamptz - interval '1 minute'"
            " from app.users where role = 'nurse' limit 1",
            (waiting,),
        )

    board = world["supervisor"].get("/dashboard", params={"days": 7}).json()
    assert board["queue"]["open"] == 3  # pended and referred are still open; one never reviewed
    assert board["stages"] == {"pended": 1, "referred": 1, "queued": 1}
    assert len(board["per_day"]) == 7 * 4  # every day and outcome, zeros included
    assert sum(d["n"] for d in board["per_day"] if d["outcome"] == "pended") == 1
    assert board["timeliness"]["decided"] == 1  # a referral does not answer the request
    assert board["timeliness"]["on_time"] == 1
    assert board["agreement"]["total"] == 2
    load = {r["role"]: r for r in board["reviewers"]}
    assert load["nurse"]["decisions"] == 2
    assert board["engine"]["done"] == 2 and board["engine"]["waiting"] == 1
    assert sum(d["n"] for d in board["per_day"] if d["outcome"] == "approved") == 0

    assert world["admin"].get("/dashboard").status_code == 200
    for role in ("nurse", "physician", "viewer"):
        assert world[role].get("/dashboard").status_code == 403
    assert world["supervisor"].get("/dashboard", params={"days": 0}).status_code == 422
