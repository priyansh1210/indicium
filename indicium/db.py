"""Database access: a connection pool, one transaction per request, and the audit log.

Plain SQL through psycopg. Rows come back as dicts.
"""

from collections.abc import Iterator
from typing import Annotated, Any

from fastapi import Depends, Request
from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from indicium.config import settings


def make_pool(url: str | None = None) -> ConnectionPool:
    """A pool of autocommit-off connections returning dict rows. The caller opens and closes it."""
    s = settings()
    return ConnectionPool(
        url or s.database_url,
        min_size=1,
        max_size=s.db_pool_max,
        timeout=s.db_timeout_seconds,
        kwargs={"row_factory": dict_row},
        open=False,
    )


def _connection(request: Request) -> Iterator[Connection]:
    # The pool commits when the request handler returns and rolls back if it raises.
    with request.app.state.pool.connection() as conn:
        yield conn


Db = Annotated[Connection, Depends(_connection)]


def audit(
    conn: Connection,
    actor: str,
    action: str,
    target_type: str,
    target_id: str | int,
    detail: dict[str, Any] | None = None,
) -> None:
    """Record one event. Call it on the same connection as the change, before the commit."""
    conn.execute(
        "insert into audit.events (actor, action, target_type, target_id, detail) "
        "values (%s, %s, %s, %s, %s)",
        (actor, action, target_type, str(target_id), Jsonb(detail or {})),
    )
