"""Sign-in, sessions, API keys and permissions.

People sign in with email and password and get a random session token in an HTTP-only cookie;
the database keeps only its hash. Machine clients (an EHR, a provider portal) send
"Authorization: Bearer ik_..." with an API key that can only submit requests.

Permissions, not a role ladder: an admin manages the system but makes no clinical decisions,
only a physician may decide a referred case (and so deny), and a supervisor watches the queue
and hands out work without deciding cases. A person with a second factor also sends the code
from their authenticator app.
"""

import hashlib
import hmac
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from psycopg import sql
from pydantic import BaseModel, Field

from indicium.api.totp import matching_step
from indicium.config import settings
from indicium.db import Db, audit

SESSION_COOKIE = "indicium_session"
PERMISSIONS = {
    "viewer": {"read"},
    "nurse": {"read", "submit", "review", "decide"},
    "physician": {"read", "submit", "review", "decide", "decide_referred"},
    "supervisor": {"read", "oversee", "assign"},
    "admin": {"read", "submit", "manage", "oversee"},
    "provider": {"submit", "track"},  # a practice's staff, in the provider portal
    "intake": {"submit"},  # API keys
}
# Failed sign-ins within the window block further attempts for that email, and (with a higher
# limit, since an office shares one address) for that client address.
MAX_FAILED_LOGINS = 5
MAX_FAILED_LOGINS_PER_IP = 30
LOGIN_WINDOW_MINUTES = 15
DEMO_PASSWORD = "indicium-demo"  # noqa: S105 - demo sign-ins only, shown on purpose
# Sent with 401 when the password was right and the second factor is still needed.
MFA_REQUIRED = "mfa_required"

router = APIRouter(prefix="/auth", tags=["auth"])


class Principal(BaseModel):
    kind: str  # "user" or "api_key"
    user_id: int | None
    email: str
    name: str
    role: str
    organization_id: int | None = None  # the practice of a provider

    @property
    def actor(self) -> str:
        """How this principal appears in the audit log."""
        return self.email if self.kind == "user" else f"api-key:{self.name}"

    @property
    def permissions(self) -> set[str]:
        return PERMISSIONS[self.role]


class Login(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=200)  # bounds the hashing work one request can cause
    code: str | None = Field(None, max_length=12)  # from an authenticator app, when one is set


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    salt = bytes.fromhex(stored.partition("$")[0])
    return hmac.compare_digest(hash_password(password, salt), stored)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# Hashing this for an unknown email makes a wrong email take as long as a wrong password.
_NO_SUCH_USER = hash_password(secrets.token_hex(8))


def current_principal(request: Request, db: Db) -> Principal:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        key = db.execute(
            "select name from app.api_keys where key_hash = %s and revoked_at is null",
            (token_hash(header[7:].strip()),),
        ).fetchone()
        if not key:
            raise HTTPException(401, "Unknown or revoked API key")
        return Principal(kind="api_key", user_id=None, email="", name=key["name"], role="intake")
    token = request.cookies.get(SESSION_COOKIE)
    user = (
        token
        and db.execute(
            "select u.user_id, u.email, u.name, u.role, u.organization_id from app.sessions s"
            " join app.users u using (user_id)"
            " where s.token_hash = %s and s.expires_at > now() and u.active",
            (token_hash(token),),
        ).fetchone()
    )
    if not user:
        raise HTTPException(401, "Sign in first")
    return Principal(kind="user", **user)


def require(permission: str):
    """A dependency that lets the request through only with this permission."""

    def check(principal: Annotated[Principal, Depends(current_principal)]) -> Principal:
        if permission not in principal.permissions:
            raise HTTPException(403, f"Your role ({principal.role}) cannot do this")
        return principal

    return check


def signed_in_person(principal: Annotated[Principal, Depends(current_principal)]) -> Principal:
    """Any person who is signed in, whatever their role; not an API key."""
    if principal.kind != "user":
        raise HTTPException(403, "This is for people signing in, not API keys")
    return principal


Person = Annotated[Principal, Depends(signed_in_person)]
Reader = Annotated[Principal, Depends(require("read"))]
Submitter = Annotated[Principal, Depends(require("submit"))]
Reviewer = Annotated[Principal, Depends(require("review"))]
Tracker = Annotated[Principal, Depends(require("track"))]
Decider = Annotated[Principal, Depends(require("decide"))]
Manager = Annotated[Principal, Depends(require("manage"))]


def _record_failed_login(request: Request, email: str, ip: str | None) -> None:
    # Its own connection: the request's transaction is rolled back when the sign-in fails.
    with request.app.state.pool.connection() as db:
        db.execute("insert into app.login_attempts (email, ip) values (%s, %s)", (email, ip))
        db.execute(
            "delete from app.login_attempts where at < now() - make_interval(mins => %s)",
            (LOGIN_WINDOW_MINUTES,),
        )


def _blocked_for(db, column: str, value: str, limit: int) -> int | None:
    """Seconds until the oldest failure in the window expires, once `limit` failures are in it."""
    if column not in ("email", "ip"):
        raise ValueError(column)
    query = sql.SQL(
        "select ceil(extract(epoch from min(at) + make_interval(mins => %(window)s) - now()))::int"
        " as seconds from app.login_attempts where {} = %(value)s"
        " and at > now() - make_interval(mins => %(window)s) having count(*) >= %(max)s"
    ).format(sql.Identifier(column))
    row = db.execute(
        query, {"value": value, "window": LOGIN_WINDOW_MINUTES, "max": limit}
    ).fetchone()
    return max(row["seconds"], 1) if row else None


@router.post("/login")
def login(credentials: Login, request: Request, response: Response, db: Db) -> Principal:
    email = credentials.email.strip().lower()
    ip = request.client.host if request.client else None
    # Attempts for one address and one email run one at a time, so parallel guesses each see the
    # earlier failures. Always address first, then email, so two requests never deadlock.
    if ip:
        db.execute("select pg_advisory_xact_lock(hashtext('login-ip:' || %s))", (ip,))
    db.execute("select pg_advisory_xact_lock(hashtext('login:' || %s))", (email,))
    # Checked before hashing, so a blocked attacker cannot make the server do the work.
    for who, seconds in (
        ("from your network", ip and _blocked_for(db, "ip", ip, MAX_FAILED_LOGINS_PER_IP)),
        ("for this email", _blocked_for(db, "email", email, MAX_FAILED_LOGINS)),
    ):
        if seconds:
            raise HTTPException(
                429,
                f"Too many failed sign-ins {who}. Try again in {seconds} seconds.",
                headers={"Retry-After": str(seconds)},
            )
    user = db.execute(
        "select user_id, email, name, role, organization_id, password_hash, email_verified_at,"
        " totp_secret, totp_last_step from app.users"
        " where email = %s and active and password_hash is not null",
        (email,),
    ).fetchone()
    valid = verify_password(credentials.password, user["password_hash"] if user else _NO_SUCH_USER)
    if not (user and valid):
        _record_failed_login(request, email, ip)
        raise HTTPException(401, "Wrong email or password")
    if user["email_verified_at"] is None:
        raise HTTPException(
            403,
            "Confirm your email address first: open the link we sent you. Lost it? "
            "Forgot your password? sends a new link, and that confirms the address too.",
        )
    if user["totp_secret"]:
        if not credentials.code:
            raise HTTPException(401, MFA_REQUIRED)
        step = matching_step(user["totp_secret"], credentials.code)
        if step is None or step <= (user["totp_last_step"] or -1):  # each code works once
            _record_failed_login(request, email, ip)
            raise HTTPException(401, "That code is wrong or was already used")
        db.execute(
            "update app.users set totp_last_step = %s where user_id = %s", (step, user["user_id"])
        )

    db.execute("delete from app.login_attempts where email = %s", (email,))
    db.execute("delete from app.sessions where expires_at < now()")  # keeps the table small
    token = secrets.token_urlsafe(32)
    hours = settings().session_hours
    db.execute(
        "insert into app.sessions (token_hash, user_id, expires_at)"
        " values (%s, %s, now() + make_interval(hours => %s))",
        (token_hash(token), user["user_id"], hours),
    )
    db.execute("update app.users set last_login_at = now() where user_id = %s", (user["user_id"],))
    audit(db, email, "auth.login", "user", user["user_id"], {"ip": ip})
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=hours * 3600,
        httponly=True,
        samesite="strict",  # never sent on a request another site starts
        secure=settings().cookie_secure,
    )
    fields = ("user_id", "email", "name", "role", "organization_id")
    return Principal(kind="user", **{k: user[k] for k in fields})


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Db) -> None:
    if token := request.cookies.get(SESSION_COOKIE):
        db.execute("delete from app.sessions where token_hash = %s", (token_hash(token),))
    response.delete_cookie(SESSION_COOKIE)


@router.get("/me")
def me(principal: Person) -> Principal:
    return principal


@router.get("/demo-users")
def demo_users(db: Db) -> list[dict]:
    """The demo's sign-ins, so the sign-in page can offer them. Empty unless demo mode is on."""
    if not settings().demo_users:
        return []
    rows = db.execute("select email, name, role from app.users order by user_id").fetchall()
    return [r | {"password": DEMO_PASSWORD} for r in rows if r["email"].endswith("demo.indicium")]
