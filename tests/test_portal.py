"""The provider portal: registration, a practice's own requests, decision emails, colleagues."""

from fastapi.testclient import TestClient

from indicium.api.portal import valid_npi
from tests import test_api
from tests.test_accounts import last_link
from tests.test_api import CASES, review_queued

world = test_api.world  # the same fixture: published policies and a signed-in client per role

PASSWORD = "practice-password-1"


def register(api, practice: str, npi: str, email: str) -> TestClient:
    """Register a practice, confirm its email, and return its signed-in first person."""
    client = TestClient(api.app)
    body = {"practice": practice, "npi": npi, "name": "Pat Office", "email": email}
    response = client.post("/auth/register", json=body | {"password": PASSWORD})
    assert response.status_code == 202, response.text
    login = {"email": email, "password": PASSWORD}
    assert client.post("/auth/login", json=login).status_code == 403  # not confirmed yet
    assert client.post("/auth/verify", json={"token": last_link(api, email)}).status_code == 204
    assert client.post("/auth/login", json=login).status_code == 200
    return client


def test_npi_check_digit():
    assert valid_npi("1234567893")  # the CMS documentation example
    assert not valid_npi("1234567890")
    assert not valid_npi("123456789")
    assert not valid_npi("12345678ab")


def test_registration_refuses_bad_and_repeated_details(api):
    client = TestClient(api.app)
    body = {"practice": "Hillside", "name": "Ann", "email": "ann@hillside.test"}
    body["password"] = PASSWORD
    bad = client.post("/auth/register", json=body | {"npi": "1234567890"})
    assert bad.status_code == 422 and "NPI" in bad.json()["detail"]
    assert client.post("/auth/register", json=body | {"npi": "1245319599"}).status_code == 202
    again = body | {"email": "other@hillside.test", "npi": "1245319599"}
    assert client.post("/auth/register", json=again).status_code == 409  # practice exists
    same_email = body | {"npi": "1003000126"}
    assert client.post("/auth/register", json=same_email).status_code == 409


def test_a_practice_follows_only_its_own_requests_and_hears_the_decision(api, world):
    riverside = register(api, "Riverside", "1679576722", "desk@riverside.test")
    lakeside = register(api, "Lakeside", "1003000134", "desk@lakeside.test")
    assert riverside.get("/auth/me").json()["role"] == "provider"
    assert riverside.get("/cases").status_code == 403  # the review worklist is not theirs

    case = CASES["lm-06-three-weeks-no-treatment"]
    services = riverside.get("/portal/services").json()
    assert case.request.procedure_code in {s["code"] for s in services}

    sent = riverside.post("/cases", json=case.request.model_dump(mode="json"))
    assert sent.status_code == 201, sent.text
    case_id = sent.json()["case_id"]
    listed = riverside.get("/portal/requests").json()["requests"]
    assert [r["case_id"] for r in listed] == [case_id]
    assert listed[0]["service"]
    assert lakeside.get("/portal/requests").json()["requests"] == []
    assert lakeside.get(f"/portal/requests/{case_id}").status_code == 404
    more = {"documents": [{"doc_id": "extra-1", "text": "Pain for six weeks now."}]}
    assert lakeside.post(f"/cases/{case_id}/documents", json=more).status_code == 404

    review_queued(api, case_id)
    run_id = world["nurse"].get(f"/cases/{case_id}").json()["review"]["run_id"]
    pend = {"run_id": run_id, "outcome": "pended", "reason": "Send the physical therapy notes."}
    assert world["nurse"].post(f"/cases/{case_id}/decision", json=pend).status_code == 200

    detail = riverside.get(f"/portal/requests/{case_id}").json()
    assert detail["case"]["status"] == "pended"
    assert [(d["outcome"], d["reason"]) for d in detail["decisions"]] == [
        ("pended", "Send the physical therapy notes.")
    ]
    assert [t["what"] for t in detail["timeline"]] == [
        "Request received",
        "More information requested",
    ]  # queueing, review runs and the checklist stay internal
    assert "checklist" not in detail and "review" not in detail
    with api.app.state.pool.connection() as conn:
        mail = conn.execute(
            "select subject, body from app.outbox where to_email = 'desk@riverside.test'"
            " order by message_id desc limit 1"
        ).fetchone()
    assert "pended" in mail["subject"] and "physical therapy notes" in mail["body"]

    # The practice answers with the documents asked for, and the case is reviewed again.
    answered = riverside.post(f"/cases/{case_id}/documents", json=more)
    assert answered.status_code == 201 and answered.json()["status"] == "queued"


def test_a_practice_invites_a_colleague(api):
    office = register(api, "Northside", "1144221847", "desk@northside.test")
    invited = office.post("/portal/team", json={"name": "Lee", "email": "lee@northside.test"})
    assert invited.status_code == 201
    token = last_link(api, "lee@northside.test")
    anonymous = TestClient(api.app)
    chosen = {"token": token, "password": PASSWORD}
    assert anonymous.post("/auth/password/set", json=chosen).status_code == 204
    login = {"email": "lee@northside.test", "password": PASSWORD}
    assert anonymous.post("/auth/login", json=login).json()["role"] == "provider"
    team = office.get("/portal/team").json()
    assert team["practice"]["npi"] == "1144221847"
    assert {p["email"] for p in team["people"]} == {"desk@northside.test", "lee@northside.test"}


def test_a_practice_cannot_flood_invitations_or_be_made_staff(api, world):
    office = register(api, "Eastside", "1245319607", "desk@eastside.test")
    codes = [
        office.post(
            "/portal/team", json={"name": f"P{i}", "email": f"p{i}@eastside.test"}
        ).status_code
        for i in range(10)
    ]
    assert codes[0] == 201 and codes[-1] == 429  # the cap counts everyone added this hour
    people = world["admin"].get("/users").json()
    desk = next(p for p in people if p["email"] == "desk@eastside.test")
    assert desk["practice"] == "Eastside"
    promote = world["admin"].patch(f"/users/{desk['user_id']}", json={"role": "physician"})
    assert promote.status_code == 409 and "provider role" in promote.json()["detail"]
