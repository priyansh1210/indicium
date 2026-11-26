"""Accounts: invitations, password resets, second factor, managing people and keys, the outbox."""

import re
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from psycopg.rows import dict_row

from indicium.api.account import send_verification
from indicium.api.totp import code_at, matching_step
from indicium.api.users import create_user
from indicium.mail import send_pending

ADMIN = ("admin@example.test", "Ada Admin", "admin", "admin-password-1")


@pytest.fixture(scope="module")
def admin(api) -> TestClient:
    with api.app.state.pool.connection() as conn:
        conn.row_factory = dict_row
        create_user(conn, ADMIN[0], ADMIN[1], ADMIN[2], ADMIN[3], "test")
    return signed_in(api, ADMIN[0], ADMIN[3])


def signed_in(api, email: str, password: str, code: str | None = None) -> TestClient:
    client = TestClient(api.app)
    response = client.post("/auth/login", json={"email": email, "password": password, "code": code})
    assert response.status_code == 200, response.text
    return client


def last_link(api, email: str) -> str:
    """The token in the newest email to this address."""
    with api.app.state.pool.connection() as conn:
        body = conn.execute(
            "select body from app.outbox where to_email = %s order by message_id desc limit 1",
            (email,),
        ).fetchone()["body"]
    return re.search(r"token=([\w-]+)", body).group(1)


def test_one_time_codes_match_rfc_6238():
    secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"  # base32 of the RFC's "12345678901234567890"
    assert code_at(secret, 59 // 30, digits=8) == "94287082"
    assert code_at(secret, 1111111109 // 30, digits=8) == "07081804"
    now = 1_700_000_000
    assert matching_step(secret, code_at(secret, now // 30 - 1), now) == now // 30 - 1  # drift
    assert matching_step(secret, code_at(secret, now // 30 - 2), now) is None
    assert matching_step(secret, "12345", now) is None


def test_an_invited_person_chooses_a_password_and_signs_in(api, admin):
    anonymous = TestClient(api.app)
    invited = admin.post(
        "/users", json={"email": "Nora@Example.test", "name": "Nora Nurse", "role": "nurse"}
    )
    assert invited.status_code == 201, invited.text
    assert (
        admin.post(
            "/users", json={"email": "nora@example.test", "name": "Again", "role": "nurse"}
        ).status_code
        == 409
    )
    token = last_link(api, "nora@example.test")
    assert token in invited.json()["link"]

    # Before accepting, there is no password to sign in with.
    login = {"email": "nora@example.test", "password": "nora-password-1"}
    assert anonymous.post("/auth/login", json=login).status_code == 401
    seen = anonymous.post("/auth/token", json={"token": token}).json()
    assert seen == {
        "purpose": "invite",
        "email": "nora@example.test",
        "name": "Nora Nurse",
        "role": "nurse",
    }
    too_short = {"token": token, "password": "short"}
    assert anonymous.post("/auth/password/set", json=too_short).status_code == 422
    chosen = {"token": token, "password": login["password"]}
    assert anonymous.post("/auth/password/set", json=chosen).status_code == 204
    assert anonymous.post("/auth/password/set", json=chosen).status_code == 404  # used up
    nurse = signed_in(api, **login)
    assert nurse.get("/auth/me").json()["role"] == "nurse"
    assert (
        nurse.post("/users", json={"email": "x@y.test", "name": "X", "role": "admin"}).status_code
        == 403
    )

    users = {u["email"]: u for u in admin.get("/users").json()}
    assert users["nora@example.test"]["state"] == "active"


def test_a_forgotten_password_is_reset_by_email_and_ends_every_session(api, admin):
    with api.app.state.pool.connection() as conn:
        conn.row_factory = dict_row
        create_user(conn, "rex@example.test", "Rex Viewer", "viewer", "rex-password-11", "test")
    old_session = signed_in(api, "rex@example.test", "rex-password-11")
    anonymous = TestClient(api.app)
    unknown = anonymous.post("/auth/forgot", json={"email": "nobody@example.test"})
    known = anonymous.post("/auth/forgot", json={"email": "REX@example.test"})
    assert unknown.status_code == known.status_code == 202
    assert unknown.json() == known.json()  # no telling which addresses have accounts

    token = last_link(api, "rex@example.test")
    anonymous.post("/auth/forgot", json={"email": "rex@example.test"})
    # A newer link replaces the older one.
    stale = {"token": token, "password": "rex-password-22"}
    assert anonymous.post("/auth/password/set", json=stale).status_code == 404
    fresh = {"token": last_link(api, "rex@example.test"), "password": "rex-password-22"}
    assert anonymous.post("/auth/password/set", json=fresh).status_code == 204
    assert old_session.get("/auth/me").status_code == 401
    signed_in(api, "rex@example.test", "rex-password-22")

    for _ in range(3):  # at most three reset emails an hour
        anonymous.post("/auth/forgot", json={"email": "rex@example.test"})
    with api.app.state.pool.connection() as conn:
        sent = conn.execute(
            "select count(*) as n from app.outbox where to_email = 'rex@example.test'"
        ).fetchone()["n"]
    assert sent == 3


def test_a_second_factor_is_needed_once_it_is_on(api, admin):
    with api.app.state.pool.connection() as conn:
        conn.row_factory = dict_row
        create_user(conn, "mia@example.test", "Mia Physician", "physician", "mia-password-11", "t")
    mia = signed_in(api, "mia@example.test", "mia-password-11")
    setup = mia.post("/auth/mfa/setup").json()
    assert setup["uri"].startswith("otpauth://totp/Indicium:mia%40example.test?secret=")
    assert setup["qr_svg"].startswith("<svg")
    assert mia.post("/auth/mfa/enable", json={"code": "abcdef"}).status_code == 400
    step = int(time.time() // 30)
    code = code_at(setup["secret"], step)
    assert mia.post("/auth/mfa/enable", json={"code": code}).status_code == 204
    assert mia.get("/auth/account").json()["mfa_enabled"] is True
    assert mia.post("/auth/mfa/setup").status_code == 409

    anonymous = TestClient(api.app)
    login = {"email": "mia@example.test", "password": "mia-password-11"}
    assert anonymous.post("/auth/login", json=login).json()["detail"] == "mfa_required"
    wrong = anonymous.post("/auth/login", json=login | {"code": "123456"})
    assert wrong.status_code == 401 and wrong.json()["detail"] != "mfa_required"
    # The code used to turn it on cannot be used again; the next one can.
    assert anonymous.post("/auth/login", json=login | {"code": code}).status_code == 401
    signed_in(api, **login, code=code_at(setup["secret"], step + 1))

    assert mia.post("/auth/mfa/disable", json={"password": "nope"}).status_code == 403
    assert mia.post("/auth/mfa/disable", json={"password": login["password"]}).status_code == 204
    signed_in(api, **login)


def test_people_change_their_own_name_and_password(api, admin):
    with api.app.state.pool.connection() as conn:
        conn.row_factory = dict_row
        create_user(conn, "lou@example.test", "Lou", "nurse", "lou-password-111", "test")
    laptop = signed_in(api, "lou@example.test", "lou-password-111")
    phone = signed_in(api, "lou@example.test", "lou-password-111")
    assert laptop.get("/auth/account").json()["other_sessions"] == 1
    assert laptop.patch("/auth/account", json={"name": "Lou Nurse"}).json() == {"name": "Lou Nurse"}
    wrong = {"current_password": "wrong", "new_password": "lou-password-222"}
    assert laptop.post("/auth/password", json=wrong).status_code == 403
    right = {"current_password": "lou-password-111", "new_password": "lou-password-222"}
    assert laptop.post("/auth/password", json=right).status_code == 204
    assert phone.get("/auth/me").status_code == 401  # other sessions end
    assert laptop.get("/auth/me").json()["name"] == "Lou Nurse"  # this one stays


def test_an_admin_changes_roles_and_deactivates_but_never_themselves(api, admin):
    with api.app.state.pool.connection() as conn:
        conn.row_factory = dict_row
        user_id = create_user(conn, "kai@example.test", "Kai", "viewer", "kai-password-111", "t")
        admin_id = conn.execute(
            "select user_id from app.users where email = %s", (ADMIN[0],)
        ).fetchone()["user_id"]
    kai = signed_in(api, "kai@example.test", "kai-password-111")
    assert admin.patch(f"/users/{admin_id}", json={"active": False}).status_code == 409
    changed = admin.patch(f"/users/{user_id}", json={"role": "nurse"})
    assert changed.json()["changed"] == {"role": "nurse"}
    assert kai.get("/auth/me").status_code == 401  # a new role takes effect at once
    kai = signed_in(api, "kai@example.test", "kai-password-111")
    assert kai.get("/auth/me").json()["role"] == "nurse"
    assert admin.patch(f"/users/{user_id}", json={"active": False}).status_code == 200
    assert kai.get("/auth/me").status_code == 401
    login = {"email": "kai@example.test", "password": "kai-password-111"}
    assert TestClient(api.app).post("/auth/login", json=login).status_code == 401
    assert admin.post(f"/users/{user_id}/link").status_code == 404  # inactive: no links
    assert admin.patch("/users/999999", json={"active": False}).status_code == 404


def test_api_keys_are_shown_once_and_stop_working_when_revoked(api, admin):
    created = admin.post("/api-keys", json={"name": "clinic-ehr"})
    assert created.status_code == 201
    key = created.json()["key"]
    assert admin.post("/api-keys", json={"name": "clinic-ehr"}).status_code == 409
    assert admin.post("/api-keys", json={"name": "Bad Name"}).status_code == 422
    listed = {k["name"]: k for k in admin.get("/api-keys").json()}
    assert "key" not in listed["clinic-ehr"] and "key_hash" not in listed["clinic-ehr"]
    machine = TestClient(api.app, headers={"Authorization": f"Bearer {key}"})
    assert machine.post("/cases", json={}).status_code == 422  # signed in, body invalid
    assert machine.get("/auth/account").status_code == 403  # keys have no account
    revoke = admin.post(f"/api-keys/{listed['clinic-ehr']['key_id']}/revoke")
    assert revoke.status_code == 200
    assert machine.post("/cases", json={}).status_code == 401


def test_the_outbox_sends_retries_and_keeps_no_links(api):
    pool = api.app.state.pool
    with pool.connection() as conn:
        conn.execute("update app.outbox set sent_at = now()")  # earlier tests' mail
        conn.execute(
            "insert into app.outbox (to_email, subject, body) values"
            " ('a@example.test', 'One', 'token=secret-1'), ('b@example.test', 'Two', 'x')"
        )
    delivered = []

    def flaky(message):
        if message["To"] == "b@example.test":
            raise OSError("connection refused")
        delivered.append((message["To"], message["Subject"], message.get_content().strip()))

    assert send_pending(pool, flaky) == 1
    assert delivered == [("a@example.test", "One", "token=secret-1")]
    with pool.connection() as conn:
        rows = conn.execute(
            "select to_email, body, attempts, sent_at is not null as sent,"
            " available_at > now() as later from app.outbox where sent_at is null"
            " or to_email = 'a@example.test' order by message_id"
        ).fetchall()
    assert [tuple(r.values()) for r in rows] == [
        ("a@example.test", "", 0, True, False),  # sent, and its link is gone
        ("b@example.test", "x", 1, False, True),  # retried later
    ]
    assert send_pending(pool, flaky) == 0  # not due yet


def test_the_activity_log_shows_who_did_what_newest_first(api, admin):
    admin.post("/users", json={"email": "ian@example.test", "name": "Ian", "role": "viewer"})
    page = admin.get("/audit", params={"action": "user.invited", "limit": 1}).json()
    assert page["events"][0]["actor"] == ADMIN[0]
    assert page["next"] is not None
    older = admin.get("/audit", params={"before": page["next"], "limit": 500}).json()["events"]
    assert all(e["event_id"] < page["next"] for e in older)
    assert admin.get("/audit", params={"actor": "nobody"}).json() == {"events": [], "next": None}


def test_a_policy_file_is_added_as_a_draft(api, admin):
    text = next(Path("data/policies").glob("*.yaml")).read_text(encoding="utf-8")
    first = admin.post("/policies/yaml", json={"yaml": text})
    assert first.status_code in (200, 201), first.text
    again = admin.post("/policies/yaml", json={"yaml": text})
    assert (again.status_code, again.json()["version_id"]) == (200, first.json()["version_id"])
    broken = admin.post("/policies/yaml", json={"yaml": "policy_id: x\ntitle: [unclosed"})
    assert broken.status_code == 422 and "YAML" in broken.json()["detail"]
    invalid = admin.post("/policies/yaml", json={"yaml": "policy_id: x\ntitle: Only a title\n"})
    assert invalid.status_code == 422 and invalid.json()["detail"].startswith("Not a valid policy")


def test_an_unconfirmed_address_signs_in_only_after_its_link(api):
    with api.app.state.pool.connection() as conn:
        conn.row_factory = dict_row
        user_id = create_user(conn, "una@example.test", "Una", "viewer", "una-password-111", "t")
        conn.execute("update app.users set email_verified_at = null where user_id = %s", (user_id,))
        una = {"user_id": user_id, "email": "una@example.test", "name": "Una"}
        send_verification(conn, una, "t")
    anonymous = TestClient(api.app)
    login = {"email": "una@example.test", "password": "una-password-111"}
    refused = anonymous.post("/auth/login", json=login)
    assert refused.status_code == 403 and "Confirm your email" in refused.json()["detail"]
    token = last_link(api, "una@example.test")
    wrong_use = {"token": token, "password": "x" * 12}  # a confirmation link sets no password
    assert anonymous.post("/auth/password/set", json=wrong_use).status_code == 404
    assert anonymous.post("/auth/verify", json={"token": token}).status_code == 204
    assert anonymous.post("/auth/verify", json={"token": token}).status_code == 404
    signed_in(api, **login)


def test_a_session_cannot_guess_its_own_password_forever(api):
    with api.app.state.pool.connection() as conn:
        conn.row_factory = dict_row
        create_user(conn, "gus@example.test", "Gus", "viewer", "gus-password-111", "test")
    gus = signed_in(api, "gus@example.test", "gus-password-111")
    guess = {"current_password": "wrong-guess", "new_password": "gus-password-222"}
    codes = [gus.post("/auth/password", json=guess).status_code for _ in range(6)]
    assert codes == [403] * 5 + [429]
    assert gus.post("/auth/mfa/disable", json={"password": "gus-password-111"}).status_code == 429


def test_a_mistyped_mail_server_stops_the_process_at_start(monkeypatch):
    from indicium.config import Settings

    monkeypatch.setenv("INDICIUM_SMTP_URL", "smtps//mail.example.test")
    with pytest.raises(ValueError, match="INDICIUM_SMTP_URL"):
        Settings()
    monkeypatch.setenv("INDICIUM_SMTP_URL", "smtp+starttls://user:pw@mail.example.test:587")
    assert Settings().smtp_url.get_secret_value().startswith("smtp+starttls://")
