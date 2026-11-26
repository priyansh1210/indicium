"""User and API key commands.

python -m indicium.api.users create EMAIL NAME ROLE      reads the password from INDICIUM_PASSWORD
python -m indicium.api.users api-key NAME                prints a new key once
python -m indicium.api.users seed-demo                   one sign-in per role and a sample
                                                         practice (demo only)
"""

import argparse
import os
import secrets
import sys

import psycopg
from psycopg.rows import dict_row

from indicium.api.auth import DEMO_PASSWORD, hash_password, token_hash
from indicium.config import settings
from indicium.db import audit

DEMO = [
    ("nurse@demo.indicium", "Avery Nurse", "nurse"),
    ("physician@demo.indicium", "Jordan Physician", "physician"),
    ("supervisor@demo.indicium", "Morgan Supervisor", "supervisor"),
    ("admin@demo.indicium", "Casey Admin", "admin"),
    ("viewer@demo.indicium", "Riley Viewer", "viewer"),
]


# Roles a person on the reviewing side can hold (API keys are "intake"; "provider" people
# belong to a practice and come from registration or a colleague's invitation).
STAFF_ROLES = {"viewer", "nurse", "physician", "supervisor", "admin"}
# The demo's sample practice. The NPI passes the check digit and is the CMS documentation example.
DEMO_PRACTICE = ("Riverside Health Partners", "1234567893")
DEMO_PROVIDER = ("office@riverside.demo.indicium", "Sam Okafor", "provider")


def create_user(
    conn,
    email: str,
    name: str,
    role: str,
    password: str,
    actor: str,
    organization_id: int | None = None,
) -> int:
    """A ready account with a known password (for the first admin, set up from the command line).
    Everyone else is invited from the admin screens and picks their own password."""
    if role not in STAFF_ROLES and not (role == "provider" and organization_id):
        raise ValueError(f"role must be one of {', '.join(sorted(STAFF_ROLES))}, not {role!r}")
    if len(password) < 12:
        raise ValueError("passwords need at least 12 characters")
    row = conn.execute(
        "insert into app.users (email, name, role, password_hash, email_verified_at,"
        " organization_id) values (%s, %s, %s, %s, now(), %s)"
        " on conflict (email) do nothing returning user_id",
        (email.strip().lower(), name, role, hash_password(password), organization_id),
    ).fetchone()
    if row:
        audit(conn, actor, "user.created", "user", row["user_id"], {"role": role})
    return row["user_id"] if row else 0


def demo_practice(conn) -> int:
    """The sample practice's id, created on first use."""
    conn.execute(
        "insert into app.organizations (name, npi) values (%s, %s) on conflict (npi) do nothing",
        DEMO_PRACTICE,
    )
    return conn.execute(
        "select organization_id from app.organizations where npi = %s", (DEMO_PRACTICE[1],)
    ).fetchone()["organization_id"]


def create_api_key(conn, name: str, actor: str) -> str:
    key = "ik_" + secrets.token_urlsafe(32)
    conn.execute(
        "insert into app.api_keys (name, key_hash, created_by) values (%s, %s, %s)",
        (name, token_hash(key), actor),
    )
    audit(conn, actor, "api_key.created", "api_key", name)
    return key


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m indicium.api.users")
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create")
    create.add_argument("email")
    create.add_argument("name")
    create.add_argument("role")
    key = commands.add_parser("api-key")
    key.add_argument("name")
    commands.add_parser("seed-demo")
    args = parser.parse_args(argv)

    with psycopg.connect(settings().database_url, row_factory=dict_row) as conn:
        if args.command == "create":
            password = os.environ.get("INDICIUM_PASSWORD", "")
            created = create_user(conn, args.email, args.name, args.role, password, "system:cli")
            print("created" if created else "already exists")
        elif args.command == "api-key":
            print(create_api_key(conn, args.name, "system:cli"))
        else:
            if not settings().demo_users:
                print("refusing: set INDICIUM_DEMO_USERS=true to seed demo sign-ins")
                return 1
            for email, name, role in DEMO:
                create_user(conn, email, name, role, DEMO_PASSWORD, "system:demo")
            practice = demo_practice(conn)
            create_user(conn, *DEMO_PROVIDER, DEMO_PASSWORD, "system:demo", practice)
            print(f"demo sign-ins ready ({len(DEMO)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
