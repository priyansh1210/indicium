import psycopg
import pytest

from indicium.db import audit


def test_health_and_ready(api):
    assert api.get("/health").json() == {"status": "ok"}
    assert api.get("/ready").json() == {"status": "ok", "db": True}


def test_audit_log_is_append_only(db_url):
    with psycopg.connect(db_url) as conn:
        audit(conn, "system:test", "thing.done", "thing", 1, {"why": "test"})
        conn.commit()
        row = conn.execute("select actor, detail from audit.events").fetchone()
        assert row == ("system:test", {"why": "test"})

        for statement in (
            "update audit.events set actor = 'someone else'",
            "delete from audit.events",
            "truncate audit.events",
        ):
            with pytest.raises(psycopg.errors.RaiseException, match="append-only"):
                conn.execute(statement)
            conn.rollback()
        assert conn.execute("select count(*) from audit.events").fetchone() == (1,)
