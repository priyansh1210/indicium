"""Notifications: who hears of what, once, and only they can read or clear it."""

from indicium.api.notifications import sweep
from tests import test_api
from tests.test_api import CASES, review_queued, submit
from tests.test_portal import register

world = test_api.world


def kinds(client) -> list[tuple[str, int]]:
    return [(n["kind"], n["case_id"]) for n in client.get("/notifications").json()["items"]]


def test_people_hear_of_their_cases_once_and_clear_only_their_own(api, world):
    nurse, supervisor = world["nurse"], world["supervisor"]
    practice = register(api, "Riverside", "1679576722", "desk@riverside.test")
    body = CASES["lm-06-three-weeks-no-treatment"].request.model_dump(mode="json")
    pended = practice.post("/cases", json=body).json()["case_id"]
    taken = submit(world, "tka-01-end-stage-oa")
    for case_id in (pended, taken):
        review_queued(api, case_id)
    nurse_id = nurse.get("/auth/me").json()["user_id"]

    # Handed a case by a supervisor: told. Taking one yourself: not.
    assign = supervisor.post(f"/cases/{pended}/assign", json={"user_id": nurse_id})
    assert assign.status_code == 200
    assert nurse.post(f"/cases/{taken}/assign", json={"user_id": nurse_id}).status_code == 200
    assert kinds(nurse) == [("assigned", pended)]

    # A decision reaches the practice; the documents that answer it reach the nurse holding it.
    run_id = nurse.get(f"/cases/{pended}").json()["review"]["run_id"]
    pend = {"run_id": run_id, "outcome": "pended", "reason": "Send the therapy notes."}
    assert nurse.post(f"/cases/{pended}/decision", json=pend).status_code == 200
    assert kinds(practice) == [("decided", pended)]
    more = {"documents": [{"doc_id": "pt-1", "text": "Six weeks of physical therapy."}]}
    assert practice.post(f"/cases/{pended}/documents", json=more).status_code == 201
    assert kinds(nurse) == [("documents", pended), ("assigned", pended)]

    # Deadlines within a day: each case once however often the sweep runs, and only cases
    # waiting on a reviewer (the other one is back in review, not with the nurse).
    with api.app.state.pool.connection() as conn:
        conn.execute(
            "update app.cases set due_at = now() + interval '2 hours' where case_id in (%s, %s)",
            (pended, taken),
        )
        assert sweep(conn) == 1
        assert sweep(conn) == 0
    assert kinds(nurse)[0] == ("due_soon", taken)

    # Reading: one, then all. Someone else naming my notification changes nothing.
    inbox = nurse.get("/notifications").json()
    assert inbox["unread"] == 3
    first = inbox["items"][0]["notification_id"]
    other = world["physician"].post("/notifications/read", json={"notification_id": first})
    assert other.status_code == 200 and nurse.get("/notifications/unread").json()["unread"] == 3
    one = nurse.post("/notifications/read", json={"notification_id": first}).json()
    assert one["unread"] == 2
    assert nurse.post("/notifications/read").json()["unread"] == 0

    assert world["intake"].get("/notifications").status_code == 403  # API keys have no inbox
    assert world["anonymous"].get("/notifications").status_code == 401
