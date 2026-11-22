"""Alembic environment. Migrations in `versions/` are plain SQL run with `op.execute`.

The database comes from INDICIUM_DATABASE_URL (see indicium/config.py).
"""

from alembic import context
from sqlalchemy import create_engine, pool, text

from indicium.config import settings

url = settings().database_url.replace("postgresql://", "postgresql+psycopg://", 1)
# NullPool closes the connection at the end, which releases the lock taken below.
engine = create_engine(url, poolclass=pool.NullPool)

with engine.connect() as connection:
    # One migration run at a time, however many containers start together.
    connection.execute(text("select pg_advisory_lock(4242001)"))
    connection.commit()
    context.configure(connection=connection)
    with context.begin_transaction():
        context.run_migrations()
