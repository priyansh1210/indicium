"""Indexes for the dashboard, which reads decisions and review runs by time.

Revision ID: 0009
Revises: 0008
"""

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    create index decisions_by_time on app.decisions (at);
    create index runs_by_time on review.runs (created_at);
    """)


def downgrade() -> None:
    raise NotImplementedError("Roll forward with a new migration instead.")
