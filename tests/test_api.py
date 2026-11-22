"""The API end to end: intake, review, checklist corrections, decisions, roles, audit."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from psycopg.rows import dict_row

from indicium.api.auth import DEMO_PASSWORD
from indicium.api.users import DEMO, create_api_key, create_user
from indicium.cases.dataset import read_cases
from indicium.policies import store as policy_store
from indicium.policies.files import policy_files, read_policy
from indicium.review.worker import claim, process
from tests.test_engine import Scripted, perfect

CASES = {c.case_id: c for c in read_cases(Path("data/cases"))}
PUBLIC = {"/health", "/ready", "/auth/login", "/auth/logout", "/auth/demo-users"}


@pytest.fixture(scope="module")
def world(api):
    """Published policies, one user per role, an intake key, and a signed-in client per role."""
    pool = api.app.state.pool
    with pool.connection() as conn:
        conn.row_factory = dict_row
        for path in policy_files([Path("data/policies")]):
            version_id, _ = policy_store.save(conn, read_policy(path), "test")
            policy_store.publish(conn, version_id, "test")
        for email, name, role in DEMO:
            create_user(conn, email, name, role, DEMO_PASSWORD, "test")
        key = create_api_key(conn, "test-portal", "test")
    clients = {}
    for email, _, role in DEMO:
        client = TestClient(api.app)
        assert (
            client.post("/auth/login", json={"email": email, "password": DEMO_PASSWORD}).status_code
            == 200
        )
        clients[role] = client
    clients["intake"] = TestClient(api.app, headers={"Authorization": f"Bearer {key}"})
    clients["anonymous"] = TestClient(api.app)
    return clients


def review_queued(api, case_id: int) -> None:
    """What a worker does: claim the case's run and review it with a perfect scripted model."""
    pool = api.app.state.pool
    with pool.connection() as conn:
        run = claim(conn, 900)
    assert run["case_id"] == case_id
    external = next(c for c in CASES.values() if c.request.external_id == _external(api, case_id))
    process(pool, Scripted(perfect(external)), run)


def _external(api, case_id: int) -> str:
    with api.app.state.pool.connection() as conn:
        return conn.execute(
            "select external_id from app.cases where case_id = %s", (case_id,)
        ).fetchone()["external_id"]


def submit(world, case_id: str) -> int:
    body = CASES[case_id].request.model_dump(mode="json")
    response = world["intake"].post("/cases", json=body)
    assert response.status_code == 201, response.text
    return response.json()["case_id"]


def test_every_route_but_the_public_ones_needs_a_sign_in(api, world):
    for path, operations in api.app.openapi()["paths"].items():
        if path in PUBLIC:
            continue
        concrete = (
            path.replace("{case_id}", "1")
            .replace("{criterion_id}", "x")
            .replace("{version_id}", "1")
        )
        for method in operations:
            response = world["anonymous"].request(method, concrete, json={})
            assert response.status_code == 401, (method, path, response.status_code)


def test_a_case_goes_from_intake_to_a_physician_decision(api, world):
    case = CASES["lm-06-three-weeks-no-treatment"]
    body = case.request.model_dump(mode="json")
    first = world["intake"].post("/cases", json=body)
    assert first.status_code == 201 and first.json()["status"] == "queued"
    again = world["intake"].post("/cases", json=body)
    assert (again.status_code, again.json()["case_id"]) == (200, first.json()["case_id"])
    body["requested_by"] = "someone else"
    assert world["intake"].post("/cases", json=body).status_code == 409
    case_id = first.json()["case_id"]

    review_queued(api, case_id)
    detail = world["nurse"].get(f"/cases/{case_id}").json()
    review = detail["review"]
    assert review["recommendation"] == "refer_to_clinician"
    items = _items(detail["checklist"])
    flagged = items["failed_conservative_care"]
    assert flagged["finding"] == "contradicted"
    text = {d["doc_id"]: d["text"] for d in detail["documents"]}
    for e in flagged["evidence"]:  # spans point at the exact text the nurse sees
        assert text[e["doc_id"]][e["start"] : e["end"]] == e["quote"]

    # The nurse corrects one item with a reason; the recommendation is recomputed, nothing lost.
    corrected = world["nurse"].post(
        f"/cases/{case_id}/checklist/results_guide_treatment",
        json={
            "run_id": review["run_id"],
            "finding": "documented",
            "reason": "Plan stated by phone",
        },
    )
    assert corrected.status_code == 200
    item = _items(world["nurse"].get(f"/cases/{case_id}").json()["checklist"])[
        "results_guide_treatment"
    ]
    assert (item["finding"], item["effective"]) == ("absent", "documented")

    # Roles: a nurse cannot deny; refer goes to a physician, who can.
    deny = {"run_id": review["run_id"], "outcome": "denied", "reason": "Criteria not met"}
    assert world["nurse"].post(f"/cases/{case_id}/decision", json=deny).status_code == 409
    refer = {"run_id": review["run_id"], "outcome": "referred", "reason": "Needs physician review"}
    assert world["nurse"].post(f"/cases/{case_id}/decision", json=refer).status_code == 200
    assert world["nurse"].post(f"/cases/{case_id}/decision", json=deny).status_code == 403
    assert world["admin"].post(f"/cases/{case_id}/decision", json=deny).status_code == 403
    decided = world["physician"].post(f"/cases/{case_id}/decision", json=deny)
    assert decided.status_code == 200 and decided.json()["status"] == "denied"
    assert world["physician"].post(f"/cases/{case_id}/decision", json=deny).status_code == 409

    actions = [e["action"] for e in world["viewer"].get(f"/cases/{case_id}/audit").json()]
    assert actions == [
        "case.received",
        "case.queued",
        "case.in_review",
        "case.awaiting_nurse",
        "review.completed",
        "checklist.overridden",
        "case.referred",
        "case.denied",
    ]


def test_a_decision_on_an_outdated_review_is_refused(api, world):
    case_id = submit(world, "cpap-01-severe-osa")
    review_queued(api, case_id)
    run_id = world["nurse"].get(f"/cases/{case_id}").json()["review"]["run_id"]
    approve = {"run_id": run_id - 1, "outcome": "approved", "reason": "Meets policy"}
    assert world["nurse"].post(f"/cases/{case_id}/decision", json=approve).status_code == 409
    approve["run_id"] = run_id
    response = world["nurse"].post(f"/cases/{case_id}/decision", json=approve)
    assert response.status_code == 200 and response.json()["against_recommendation"] is False


def test_a_pended_case_is_reviewed_again_when_documents_arrive(api, world):
    case_id = submit(world, "tka-05-no-imaging")
    review_queued(api, case_id)
    run_id = world["nurse"].get(f"/cases/{case_id}").json()["review"]["run_id"]
    pend = {"run_id": run_id, "outcome": "pended", "reason": "Need knee radiographs"}
    assert world["nurse"].post(f"/cases/{case_id}/decision", json=pend).status_code == 200
    xray = {"doc_id": "xray-new", "kind": "imaging_report", "text": "Bone-on-bone medial joint."}
    added = world["intake"].post(f"/cases/{case_id}/documents", json={"documents": [xray]})
    assert added.status_code == 201 and added.json()["status"] == "queued"
    again = world["intake"].post(f"/cases/{case_id}/documents", json={"documents": [xray]})
    assert again.status_code == 409  # not while it is queued, and never the same id twice


def test_roles_only_do_what_they_are_allowed(world):
    body = CASES["esi-01-radiculopathy-meets"].request.model_dump(mode="json")
    assert world["viewer"].post("/cases", json=body).status_code == 403
    assert world["intake"].get("/cases").status_code == 403
    assert world["viewer"].get("/cases").status_code == 200
    assert world["nurse"].post("/policies/versions/1/publish").status_code == 403
    assert world["admin"].post("/policies/versions/1/publish").status_code == 200


def test_fhir_intake_and_bad_bundles(world):
    from tests.test_fhir import bundle

    response = world["intake"].post("/cases/fhir", json=bundle())
    assert response.status_code == 201, response.text
    assert world["intake"].post("/cases/fhir", json={"resourceType": "Patient"}).status_code == 422


def test_oversized_bodies_and_bad_cursors_are_refused(world):
    huge = {"x": "a" * 6_000_000}
    assert world["intake"].post("/cases", json=huge).status_code == 413
    assert world["viewer"].get("/cases", params={"after": "not-a-cursor"}).status_code == 400


def test_the_worklist_pages_without_gaps_or_repeats(world):
    seen, after = [], None
    while True:
        page = (
            world["viewer"]
            .get("/cases", params={"limit": 2, **({"after": after} if after else {})})
            .json()
        )
        seen += [c["case_id"] for c in page["cases"]]
        if not (after := page["next"]):
            break
    everything = [
        c["case_id"] for c in world["viewer"].get("/cases", params={"limit": 200}).json()["cases"]
    ]
    assert seen == everything and len(set(seen)) == len(seen)


def test_repeated_wrong_passwords_are_slowed_down(api):
    client = TestClient(api.app)
    for _ in range(5):
        assert (
            client.post(
                "/auth/login", json={"email": "nobody@x.y", "password": "wrong"}
            ).status_code
            == 401
        )
    blocked = client.post("/auth/login", json={"email": "nobody@x.y", "password": "wrong"})
    assert blocked.status_code == 429 and int(blocked.headers["Retry-After"]) > 0


def _items(node: dict) -> dict:
    if node["type"] == "criterion":
        return {node["id"]: node}
    return {k: v for item in node["items"] for k, v in _items(item).items()}


def test_a_write_is_committed_before_its_response_is_sent(api):
    """Read-your-writes from a second connection the moment the response arrives."""
    from indicium.api.auth import SESSION_COOKIE, token_hash

    client = TestClient(api.app)
    client.post("/auth/login", json={"email": "nurse@demo.indicium", "password": DEMO_PASSWORD})
    token = client.cookies[SESSION_COOKIE]
    with api.app.state.pool.connection() as other:
        found = other.execute(
            "select 1 from app.sessions where token_hash = %s", (token_hash(token),)
        ).fetchone()
    assert found
