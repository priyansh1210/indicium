"""The worklist: search, filters, sorting, paging, and who is working each case."""

import pytest
from psycopg.rows import dict_row

from tests import test_api
from tests.test_api import review_queued, submit

world = test_api.world

CASES = ["lm-06-three-weeks-no-treatment", "tka-01-end-stage-oa", "cpap-02-mild-with-sleepiness"]


@pytest.fixture(scope="module")
def reviewed(api, world):
    ids = {name: submit(world, name) for name in CASES}
    for case_id in ids.values():
        review_queued(api, case_id)
    with api.app.state.pool.connection() as conn:
        conn.row_factory = dict_row
        people = {
            r["role"]: r["user_id"]
            for r in conn.execute("select user_id, role from app.users").fetchall()
        }
    return ids, people


def listed(client, **params) -> list[int]:
    response = client.get("/cases", params=params)
    assert response.status_code == 200, response.text
    return [c["case_id"] for c in response.json()["cases"]]


def test_search_finds_by_patient_member_id_code_and_service(world, reviewed):
    ids, _ = reviewed
    nurse = world["nurse"]
    case = nurse.get(f"/cases/{ids['tka-01-end-stage-oa']}").json()["case"]
    for text in (
        case["patient"]["name"].split()[-1].upper(),
        case["patient"]["member_id"],
        case["external_id"],
        "knee arthroplasty",
    ):
        assert ids["tka-01-end-stage-oa"] in listed(nurse, q=text), text
    assert listed(nurse, q="no such patient anywhere") == []
    assert listed(nurse, q="100%_") == []  # wildcards are taken literally


def test_sorting_and_paging_cover_every_case_once(world, reviewed):
    nurse = world["nurse"]
    for sort in ("due", "received"):
        seen, after = [], None
        while True:
            params = {"sort": sort, "limit": 1} | ({"after": after} if after else {})
            page = nurse.get("/cases", params=params).json()
            seen += [c["case_id"] for c in page["cases"]]
            after = page["next"]
            if not after:
                break
        everything = listed(nurse, sort=sort, limit=200)
        assert seen == everything and len(set(seen)) == len(seen), sort
    received = listed(nurse, sort="received", limit=200)
    assert received == sorted(received, reverse=True)


def test_reviewers_take_cases_and_supervisors_hand_them_out(world, reviewed):
    ids, people = reviewed
    nurse, physician, supervisor = world["nurse"], world["physician"], world["supervisor"]
    tka, cpap = ids["tka-01-end-stage-oa"], ids["cpap-02-mild-with-sleepiness"]

    assert nurse.post(f"/cases/{tka}/assign", json={"user_id": people["nurse"]}).status_code == 200
    assert listed(nurse, assigned="me") == [tka]
    assert tka not in listed(nurse, assigned="none")
    assert nurse.get("/cases/summary").json()["mine"] == 1
    assert nurse.get(f"/cases/{tka}").json()["assignee"]["role"] == "nurse"
    # A reviewer cannot take someone else's case, or give one away.
    taken = physician.post(f"/cases/{tka}/assign", json={"user_id": people["physician"]})
    assert taken.status_code == 403
    give = nurse.post(f"/cases/{cpap}/assign", json={"user_id": people["physician"]})
    assert give.status_code == 403
    assert world["viewer"].post(f"/cases/{cpap}/assign", json={"user_id": None}).status_code == 403

    # A supervisor reassigns, sees workload, and cannot hand work to a viewer.
    moved = supervisor.post(f"/cases/{tka}/assign", json={"user_id": people["physician"]})
    assert moved.status_code == 200
    load = {r["role"]: r["open_cases"] for r in supervisor.get("/cases/reviewers").json()}
    assert load == {"nurse": 0, "physician": 1}
    to_viewer = supervisor.post(f"/cases/{cpap}/assign", json={"user_id": people["viewer"]})
    assert to_viewer.status_code == 409
    assert nurse.get("/cases/reviewers").status_code == 403
    assert supervisor.post(f"/cases/{cpap}/decision", json={}).status_code in (403, 422)

    actions = [e["action"] for e in nurse.get(f"/cases/{tka}/audit").json()]
    assert actions.count("case.assigned") == 2


def test_referring_a_case_returns_it_to_the_physicians_queue(world, reviewed):
    ids, people = reviewed
    nurse = world["nurse"]
    case_id = ids["lm-06-three-weeks-no-treatment"]
    nurse.post(f"/cases/{case_id}/assign", json={"user_id": people["nurse"]})
    run_id = nurse.get(f"/cases/{case_id}").json()["review"]["run_id"]
    refer = {"run_id": run_id, "outcome": "referred", "reason": "Needs a physician"}
    assert nurse.post(f"/cases/{case_id}/decision", json=refer).status_code == 200
    assert nurse.get(f"/cases/{case_id}").json()["assignee"] is None
    to_nurse = world["supervisor"].post(
        f"/cases/{case_id}/assign", json={"user_id": people["nurse"]}
    )
    assert to_nurse.status_code == 409  # a referred case goes to a physician
    assert case_id in listed(nurse, assigned="none", status="referred")
    assert case_id in listed(nurse, flagged="false", due_within_hours=24 * 30)
