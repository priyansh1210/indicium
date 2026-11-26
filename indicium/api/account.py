"""Your own account, and the one-use links that set a password or confirm an email address.

A link carries a random token; the database keeps its hash. Opening an invitation or a reset link
sets a password and also proves the email address. Setting a password signs out every session.
"""

import secrets
from datetime import timedelta
from typing import Annotated, Literal

import segno
from fastapi import APIRouter, HTTPException, Request
from psycopg import Connection
from pydantic import BaseModel, Field

from indicium.api.auth import (
    MAX_FAILED_LOGINS,
    SESSION_COOKIE,
    Person,
    Principal,
    _blocked_for,
    _record_failed_login,
    hash_password,
    token_hash,
    verify_password,
)
from indicium.api.totp import matching_step, new_secret, provisioning_uri
from indicium.config import settings
from indicium.db import Db, audit
from indicium.mail import link, queue_email

router = APIRouter(prefix="/auth", tags=["account"])

Password = Annotated[str, Field(min_length=12, max_length=200)]
Purpose = Literal["invite", "reset", "verify"]
MAX_RESETS_PER_HOUR = 3
PAGE = {"invite": "/set-password", "reset": "/set-password", "verify": "/verify-email"}


def issue_token(
    db: Connection, user_id: int, purpose: Purpose, actor: str, lifetime: timedelta
) -> str:
    """A new one-use link token. An older unused link for the same purpose stops working."""
    token = secrets.token_urlsafe(32)
    db.execute(
        "update app.account_tokens set used_at = now()"
        " where user_id = %s and purpose = %s and used_at is null",
        (user_id, purpose),
    )
    db.execute(
        "insert into app.account_tokens (token_hash, user_id, purpose, created_by, expires_at)"
        " values (%s, %s, %s, %s, now() + %s)",
        (token_hash(token), user_id, purpose, actor, lifetime),
    )
    return link(f"{PAGE[purpose]}?token={token}")


def send_invite(db: Connection, user: dict, actor: str) -> str:
    hours = settings().invite_hours
    url = issue_token(db, user["user_id"], "invite", actor, timedelta(hours=hours))
    queue_email(
        db,
        user["email"],
        "You are invited to Indicium",
        f"Hello {user['name']},\n\n"
        f"You have been given a {user['role']} account on Indicium, the prior-authorization "
        f"review workspace. Choose a password to start:\n\n{url}\n\n"
        f"The link works once and expires in {hours} hours.\n",
    )
    return url


def send_reset(db: Connection, user: dict, actor: str) -> str:
    minutes = settings().reset_minutes
    url = issue_token(db, user["user_id"], "reset", actor, timedelta(minutes=minutes))
    queue_email(
        db,
        user["email"],
        "Reset your Indicium password",
        f"Hello {user['name']},\n\nSomeone asked to reset the password of this Indicium "
        f"account. If it was you, choose a new one here:\n\n{url}\n\nThe link works once and "
        f"expires in {minutes} minutes. If it was not you, ignore this email: nothing changes.\n",
    )
    return url


def send_verification(db: Connection, user: dict, actor: str) -> str:
    url = issue_token(db, user["user_id"], "verify", actor, timedelta(hours=48))
    queue_email(
        db,
        user["email"],
        "Confirm your email address for Indicium",
        f"Hello {user['name']},\n\nConfirm this address to finish setting up your Indicium "
        f"account:\n\n{url}\n\nThe link works once and expires in 48 hours.\n",
    )
    return url


def _token_row(db: Connection, token: str, purposes: tuple[str, ...]):
    # Locked, so two tabs sending the same link cannot both use it.
    row = db.execute(
        "select t.token_hash, t.purpose, u.user_id, u.email, u.name, u.role"
        " from app.account_tokens t join app.users u using (user_id)"
        " where t.token_hash = %s and t.used_at is null and t.expires_at > now() and u.active"
        " and t.purpose = any(%s) for update of t",
        (token_hash(token), list(purposes)),
    ).fetchone()
    if not row:
        raise HTTPException(404, "This link has expired or was already used. Ask for a new one.")
    return row


class TokenIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)


@router.post("/token")
def inspect_token(body: TokenIn, db: Db) -> dict:
    """Whose link this is and what it is for, so its page can greet the person."""
    row = _token_row(db, body.token, ("invite", "reset", "verify"))
    return {k: row[k] for k in ("purpose", "email", "name", "role")}


class SetPassword(TokenIn):
    password: Password


@router.post("/password/set", status_code=204)
def set_password(body: SetPassword, db: Db) -> None:
    """Choose a password from an invitation or a reset link."""
    row = _token_row(db, body.token, ("invite", "reset"))
    db.execute(
        "update app.users set password_hash = %s,"
        " email_verified_at = coalesce(email_verified_at, now()) where user_id = %s",
        (hash_password(body.password), row["user_id"]),
    )
    db.execute(
        "update app.account_tokens set used_at = now() where token_hash = %s", (row["token_hash"],)
    )
    db.execute("delete from app.sessions where user_id = %s", (row["user_id"],))
    audit(db, row["email"], "user.password_set", "user", row["user_id"], {"via": row["purpose"]})


@router.post("/verify", status_code=204)
def verify_email(body: TokenIn, db: Db) -> None:
    row = _token_row(db, body.token, ("verify",))
    db.execute(
        "update app.users set email_verified_at = coalesce(email_verified_at, now())"
        " where user_id = %s",
        (row["user_id"],),
    )
    db.execute(
        "update app.account_tokens set used_at = now() where token_hash = %s", (row["token_hash"],)
    )
    audit(db, row["email"], "user.email_verified", "user", row["user_id"])


class Forgot(BaseModel):
    email: str = Field(max_length=320)


@router.post("/forgot", status_code=202)
def forgot(body: Forgot, db: Db) -> dict:
    """Email a reset link. The answer is the same whether or not the address has an account."""
    email = body.email.strip().lower()
    # One request per address at a time, so parallel requests cannot all pass the cap below.
    db.execute("select pg_advisory_xact_lock(hashtext('forgot:' || %s))", (email,))
    user = db.execute(
        "select user_id, email, name, role from app.users where email = %s and active", (email,)
    ).fetchone()
    if user:
        recent = db.execute(
            "select count(*) as n from app.account_tokens where user_id = %s"
            " and purpose = 'reset' and created_at > now() - interval '1 hour'",
            (user["user_id"],),
        ).fetchone()["n"]
        if recent < MAX_RESETS_PER_HOUR:  # beyond that, quietly nothing: no mail bombing
            send_reset(db, user, email)
            audit(db, email, "user.reset_requested", "user", user["user_id"])
    return {"detail": "If that address has an account, a link to reset its password is on its way."}


def _current_token(request: Request) -> str:
    return token_hash(request.cookies.get(SESSION_COOKIE, ""))


@router.get("/account")
def account(principal: Person, request: Request, db: Db) -> dict:
    row = db.execute(
        "select user_id, email, name, role, created_at, last_login_at,"
        " totp_secret is not null as mfa_enabled,"
        " (select count(*) from app.sessions s where s.user_id = u.user_id"
        "   and s.expires_at > now() and s.token_hash <> %s) as other_sessions"
        " from app.users u where user_id = %s",
        (_current_token(request), principal.user_id),
    ).fetchone()
    return row


class AccountIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


@router.patch("/account")
def rename(body: AccountIn, principal: Person, db: Db) -> dict:
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "A name is needed")
    db.execute("update app.users set name = %s where user_id = %s", (name, principal.user_id))
    audit(db, principal.actor, "user.renamed", "user", principal.user_id, {"to": name})
    return {"name": name}


class ChangePassword(BaseModel):
    current_password: str = Field(max_length=200)
    new_password: Password


def _check_password(db: Connection, request: Request, principal: Principal, password: str) -> None:
    """The current password, under the same failure limit as signing in: a stolen session
    cannot be used to guess it."""
    db.execute("select pg_advisory_xact_lock(hashtext('login:' || %s))", (principal.email,))
    if seconds := _blocked_for(db, "email", principal.email, MAX_FAILED_LOGINS):
        raise HTTPException(
            429,
            f"Too many wrong passwords. Try again in {seconds} seconds.",
            headers={"Retry-After": str(seconds)},
        )
    stored = db.execute(
        "select password_hash from app.users where user_id = %s", (principal.user_id,)
    ).fetchone()["password_hash"]
    if not (stored and verify_password(password, stored)):
        _record_failed_login(request, principal.email, None)
        raise HTTPException(403, "Your current password is not right")


@router.post("/password", status_code=204)
def change_password(body: ChangePassword, principal: Person, request: Request, db: Db) -> None:
    """Change your password. Every other session is signed out; this one stays."""
    _check_password(db, request, principal, body.current_password)
    db.execute(
        "update app.users set password_hash = %s where user_id = %s",
        (hash_password(body.new_password), principal.user_id),
    )
    db.execute(
        "delete from app.sessions where user_id = %s and token_hash <> %s",
        (principal.user_id, _current_token(request)),
    )
    audit(db, principal.actor, "user.password_changed", "user", principal.user_id)


@router.post("/sessions/revoke-others")
def revoke_other_sessions(principal: Person, request: Request, db: Db) -> dict:
    revoked = db.execute(
        "delete from app.sessions where user_id = %s and token_hash <> %s",
        (principal.user_id, _current_token(request)),
    ).rowcount
    audit(db, principal.actor, "user.sessions_revoked", "user", principal.user_id, {"n": revoked})
    return {"revoked": revoked}


@router.post("/mfa/setup")
def mfa_setup(principal: Person, db: Db) -> dict:
    """Start adding an authenticator app: a new secret, shown once, as text and as a QR code."""
    # shortcut: TOTP secrets sit unencrypted in app.users (the database is private and its disk
    # encrypted); wrap them with a key from Key Vault once real staff accounts use this.
    secret = new_secret()
    updated = db.execute(
        "update app.users set totp_pending = %s where user_id = %s and totp_secret is null",
        (secret, principal.user_id),
    ).rowcount
    if not updated:
        raise HTTPException(409, "A second factor is already on; turn it off first to replace it")
    uri = provisioning_uri(secret, principal.email)
    qr = segno.make(uri, error="m").svg_inline(scale=5, border=2, dark="#1d1c1a", light="#ffffff")
    return {"secret": secret, "uri": uri, "qr_svg": qr}


class CodeIn(BaseModel):
    code: str = Field(min_length=6, max_length=12)


@router.post("/mfa/enable", status_code=204)
def mfa_enable(body: CodeIn, principal: Person, db: Db) -> None:
    """Turn the second factor on once the app shows a code that matches the new secret."""
    pending = db.execute(
        "select totp_pending from app.users where user_id = %s for update", (principal.user_id,)
    ).fetchone()["totp_pending"]
    if not pending:
        raise HTTPException(409, "Start the setup again")
    step = matching_step(pending, body.code)
    if step is None:
        raise HTTPException(400, "That code does not match. Check your phone's clock and retry.")
    db.execute(
        "update app.users set totp_secret = totp_pending, totp_pending = null, totp_last_step = %s"
        " where user_id = %s",
        (step, principal.user_id),
    )
    audit(db, principal.actor, "user.mfa_enabled", "user", principal.user_id)


class PasswordIn(BaseModel):
    password: str = Field(max_length=200)


@router.post("/mfa/disable", status_code=204)
def mfa_disable(body: PasswordIn, principal: Person, request: Request, db: Db) -> None:
    _check_password(db, request, principal, body.password)
    db.execute(
        "update app.users set totp_secret = null, totp_pending = null, totp_last_step = null"
        " where user_id = %s",
        (principal.user_id,),
    )
    audit(db, principal.actor, "user.mfa_disabled", "user", principal.user_id)
