"""Policies in the database: save a version, publish it, find the published one for a code.

Every change takes a per-policy transaction lock, so two admins (or two loaders) cannot number or
publish versions of the same policy at the same time. Each change is audited in its transaction.
"""

import hashlib

from psycopg import Connection
from psycopg.types.json import Jsonb

from indicium.db import audit
from indicium.policies.model import Policy


def _lock(conn: Connection, policy_id: str) -> None:
    conn.execute("select pg_advisory_xact_lock(hashtext('policy:' || %s))", (policy_id,))


def save(conn: Connection, policy: Policy, actor: str) -> tuple[int, bool]:
    """Store a policy as a draft version. Returns (version_id, created); identical content that is
    already stored is not stored again."""
    document = policy.model_dump(mode="json")
    # The download time is not content: re-fetching an unchanged LCD must not make a new version.
    content = policy.model_dump_json(exclude={"source": {"retrieved_at"}})
    digest = hashlib.sha256(content.encode()).hexdigest()
    _lock(conn, policy.policy_id)
    existing = conn.execute(
        "select version_id from policy.versions where policy_id = %s and content_hash = %s",
        (policy.policy_id, digest),
    ).fetchone()
    if existing:
        return existing["version_id"], False
    row = conn.execute(
        "insert into policy.versions"
        " (policy_id, version, title, document, content_hash, created_by)"
        " select %s, coalesce(max(version), 0) + 1, %s, %s, %s, %s"
        " from policy.versions where policy_id = %s"
        " returning version_id, version",
        (policy.policy_id, policy.title, Jsonb(document), digest, actor, policy.policy_id),
    ).fetchone()
    with conn.cursor() as cur:
        cur.executemany(
            "insert into policy.procedure_codes (version_id, code) values (%s, %s)",
            [(row["version_id"], c.code) for c in policy.procedure_codes],
        )
    audit(
        conn,
        actor,
        "policy.version_created",
        "policy_version",
        row["version_id"],
        {"policy_id": policy.policy_id, "version": row["version"], "content_hash": digest},
    )
    return row["version_id"], True


def publish(conn: Connection, version_id: int, actor: str) -> None:
    """Make a version the one reviews use; the previously published version is retired."""
    found = conn.execute(
        "select policy_id from policy.versions where version_id = %s", (version_id,)
    ).fetchone()
    if not found:
        raise LookupError(f"policy version {version_id} does not exist")
    _lock(conn, found["policy_id"])
    # Read the status after taking the lock: another publish may have finished meanwhile.
    status = conn.execute(
        "select status from policy.versions where version_id = %s", (version_id,)
    ).fetchone()["status"]
    if status == "published":
        return
    retired = conn.execute(
        "update policy.versions set status = 'retired'"
        " where policy_id = %s and status = 'published' returning version_id",
        (found["policy_id"],),
    ).fetchall()
    conn.execute(
        "update policy.versions set status = 'published', published_by = %s, published_at = now()"
        " where version_id = %s",
        (actor, version_id),
    )
    audit(
        conn,
        actor,
        "policy.published",
        "policy_version",
        version_id,
        {"policy_id": found["policy_id"], "retired": [r["version_id"] for r in retired]},
    )


def has_published(conn: Connection, policy_id: str) -> bool:
    return bool(
        conn.execute(
            "select 1 from policy.versions where policy_id = %s and status = 'published'",
            (policy_id,),
        ).fetchone()
    )


def published_for_code(conn: Connection, code: str) -> list[dict]:
    """Published policy versions that cover a procedure code. More than one is possible (two
    policies naming the same code), and the caller must not pick one silently."""
    return conn.execute(
        "select v.version_id, v.policy_id, v.version, v.title"
        " from policy.procedure_codes c join policy.versions v using (version_id)"
        " where c.code = %s and v.status = 'published' order by v.policy_id",
        (code.strip().upper(),),
    ).fetchall()


def load_version(conn: Connection, version_id: int) -> Policy:
    row = conn.execute(
        "select document from policy.versions where version_id = %s", (version_id,)
    ).fetchone()
    if not row:
        raise LookupError(f"policy version {version_id} does not exist")
    return Policy.model_validate(row["document"])
