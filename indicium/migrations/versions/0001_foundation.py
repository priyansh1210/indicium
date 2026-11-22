"""Foundation: pgvector and the append-only audit log.

Revision ID: 0001
Revises:
"""

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    create extension if not exists vector;

    create schema audit;

    -- One row per audited event. Rows are never changed or removed (see the triggers below).
    create table audit.events (
        event_id    bigint generated always as identity primary key,
        at          timestamptz not null default now(),
        actor       text not null,          -- a user's email, or system:<component>
        action      text not null,          -- e.g. review.completed, case.decided
        target_type text not null,
        target_id   text not null,
        detail      jsonb not null default '{}'
    );
    create index events_target on audit.events (target_type, target_id, at);
    create index events_at on audit.events (at);

    create function audit.reject_change() returns trigger language plpgsql as $$
    begin
        raise exception 'audit.events is append-only';
    end $$;
    create trigger events_no_update_delete before update or delete on audit.events
        for each row execute function audit.reject_change();
    create trigger events_no_truncate before truncate on audit.events
        for each statement execute function audit.reject_change();
    """)


def downgrade() -> None:
    raise NotImplementedError("Roll forward with a new migration instead.")
