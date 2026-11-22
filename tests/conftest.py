"""Shared test database: one Postgres container per run, migrated once into a template database.

Each test module takes its own copy of the template (about a second), so tests never share rows.
"""

import itertools
from collections.abc import Callable, Iterator

import psycopg
import pytest
from alembic import command
from alembic.config import Config
from psycopg import sql
from testcontainers.community.postgres import PostgresContainer

from indicium.config import settings

PG_IMAGE = "pgvector/pgvector:pg17"
_names = itertools.count()


@pytest.fixture(scope="session")
def new_database() -> Iterator[Callable[[], str]]:
    """Call it to get the URL of a fresh, fully migrated database."""
    with PostgresContainer(PG_IMAGE, driver=None) as postgres, pytest.MonkeyPatch.context() as env:
        template_url = postgres.get_connection_url()
        server_url = template_url.rsplit("/", 1)[0]
        env.setenv("INDICIUM_DATABASE_URL", template_url)
        settings.cache_clear()
        command.upgrade(Config("alembic.ini"), "head")
        settings.cache_clear()

        def copy() -> str:
            name = f"t{next(_names)}"
            with psycopg.connect(f"{server_url}/postgres", autocommit=True) as admin:
                # The template must have no open connections while it is copied.
                admin.execute(
                    sql.SQL("create database {} template {}").format(
                        sql.Identifier(name), sql.Identifier(template_url.rsplit("/", 1)[1])
                    )
                )
            return f"{server_url}/{name}"

        yield copy


@pytest.fixture(scope="module")
def db_url(new_database) -> str:
    return new_database()


@pytest.fixture(scope="module")
def api(db_url) -> Iterator:
    """The API, started against this module's database."""
    from fastapi.testclient import TestClient

    with pytest.MonkeyPatch.context() as env:
        env.setenv("INDICIUM_DATABASE_URL", db_url)
        settings.cache_clear()
        from indicium.api.main import app

        with TestClient(app) as client:
            yield client
    settings.cache_clear()
