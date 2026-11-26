"""Assignment: who is working a case.

Revision ID: 0008
Revises: 0007
"""

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    alter table app.cases add column assigned_to bigint references app.users;
    alter table app.cases add column assigned_at timestamptz;
    create index cases_by_assignee on app.cases (assigned_to, status) where assigned_to is not null;
    """)


def downgrade() -> None:
    raise NotImplementedError("Roll forward with a new migration instead.")
