from datetime import datetime
from pathlib import Path

import psycopg
import pytest
from psycopg.rows import dict_row

from indicium.policies import store
from indicium.policies.files import policy_files, read_policy

POLICY_DIR = Path("data/policies")


def test_every_shipped_policy_is_valid():
    files = policy_files([POLICY_DIR])
    assert files, "no policies shipped"
    for path in files:
        read_policy(path)  # raises with the file name and every problem


@pytest.fixture(scope="module")
def conn(db_url):
    with psycopg.connect(db_url, row_factory=dict_row, autocommit=False) as conn:
        yield conn


def test_versions_publish_and_lookup(conn):
    policy = read_policy(next(iter(policy_files([POLICY_DIR]))))
    code = policy.procedure_codes[0].code

    v1, created = store.save(conn, policy, "admin@test")
    assert created
    assert store.save(conn, policy, "admin@test") == (v1, False)  # same content loads once
    refetched = policy.model_copy(
        update={"source": policy.source.model_copy(update={"retrieved_at": datetime(2030, 1, 1)})}
    )
    assert store.save(conn, refetched, "admin@test") == (v1, False)  # download time is not content
    assert store.published_for_code(conn, code) == []  # drafts are never used

    changed = policy.model_copy(update={"title": policy.title + " (revised)"})
    v2, created = store.save(conn, changed, "admin@test")
    assert created and v2 != v1

    store.publish(conn, v1, "admin@test")
    store.publish(conn, v2, "admin@test")
    store.publish(conn, v2, "admin@test")  # publishing twice changes nothing
    found = store.published_for_code(conn, code.lower())
    assert [(r["version_id"], r["version"]) for r in found] == [(v2, 2)]
    statuses = conn.execute(
        "select version, status from policy.versions where policy_id = %s order by version",
        (policy.policy_id,),
    ).fetchall()
    assert statuses == [
        {"version": 1, "status": "retired"},
        {"version": 2, "status": "published"},
    ]
    assert store.load_version(conn, v2) == changed

    actions = conn.execute(
        "select action from audit.events where target_type = 'policy_version' order by event_id"
    ).fetchall()
    assert [a["action"] for a in actions] == [
        "policy.version_created",
        "policy.version_created",
        "policy.published",
        "policy.published",
    ]
    conn.commit()


def test_a_stored_version_cannot_be_edited(conn):
    with pytest.raises(psycopg.errors.RaiseException, match="immutable"):
        conn.execute("update policy.versions set document = '{}'::jsonb")
    conn.rollback()


def test_two_published_versions_of_one_policy_are_impossible(conn):
    with pytest.raises(psycopg.errors.UniqueViolation):
        conn.execute("update policy.versions set status = 'published'")
    conn.rollback()


def test_reloading_shipped_files_never_undoes_a_later_publish(db_url, monkeypatch, tmp_path):
    from indicium.config import settings
    from indicium.policies.__main__ import main
    from indicium.policies.files import write_yaml

    monkeypatch.setenv("INDICIUM_DATABASE_URL", db_url)
    settings.cache_clear()
    shipped = read_policy(policy_files([POLICY_DIR])[-1])
    path = tmp_path / "p.yaml"
    write_yaml(shipped.model_dump(mode="json"), path)
    assert main(["load", str(path), "--publish"]) == 0

    with psycopg.connect(db_url, row_factory=dict_row) as conn:  # an admin publishes a revision
        revised = shipped.model_copy(update={"title": shipped.title + " v2"})
        revision, _ = store.save(conn, revised, "admin@test")
        store.publish(conn, revision, "admin@test")

    assert main(["load", str(path), "--publish"]) == 0  # e.g. the stack restarts
    with psycopg.connect(db_url, row_factory=dict_row) as conn:
        code = shipped.procedure_codes[0].code
        assert [r["version_id"] for r in store.published_for_code(conn, code)] == [revision]
    settings.cache_clear()
