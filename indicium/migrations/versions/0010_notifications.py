"""Notifications: what a person should look at, written with the change that causes it.

A row names only the person, the kind and the case; the words are made when it is read, so no
patient detail is copied into another table.

Revision ID: 0010
Revises: 0009
"""

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    create table app.notifications (
        notification_id bigint generated always as identity primary key,
        user_id         bigint not null references app.users,
        kind            text not null
                        check (kind in ('assigned', 'documents', 'due_soon', 'decided')),
        case_id         bigint not null references app.cases,
        created_at      timestamptz not null default now(),
        read_at         timestamptz
    );
    create index notifications_by_user on app.notifications (user_id, notification_id desc);
    create index notifications_unread on app.notifications (user_id) where read_at is null;
    -- The deadline sweep runs again and again; each person hears about a case's deadline once.
    create unique index notifications_due_once on app.notifications (user_id, case_id)
        where kind = 'due_soon';
    """)


def downgrade() -> None:
    raise NotImplementedError("Roll forward with a new migration instead.")
