"""Users, sessions, API keys, sign-in limits, checklist overrides and decisions.

Revision ID: 0005
Revises: 0004
"""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    create table app.users (
        user_id       bigint generated always as identity primary key,
        email         text not null unique,
        name          text not null,
        role          text not null check (role in ('viewer', 'nurse', 'physician', 'admin')),
        password_hash text not null,
        active        boolean not null default true,
        created_at    timestamptz not null default now()
    );

    -- A session is a random token in an HTTP-only cookie; only its hash is stored.
    create table app.sessions (
        token_hash text primary key,
        user_id    bigint not null references app.users on delete cascade,
        created_at timestamptz not null default now(),
        expires_at timestamptz not null
    );
    create index sessions_expiry on app.sessions (expires_at);

    create table app.login_attempts (
        email text not null,
        ip    text,
        at    timestamptz not null default now()
    );
    create index login_attempts_email on app.login_attempts (email, at);
    create index login_attempts_ip on app.login_attempts (ip, at);

    -- Machine clients (an EHR or a provider portal) submit requests with a bearer key.
    create table app.api_keys (
        key_id     bigint generated always as identity primary key,
        name       text not null unique,
        key_hash   text not null unique,
        created_by text not null,
        created_at timestamptz not null default now(),
        revoked_at timestamptz
    );

    -- Shared guard for tables that are history: rows are added, never changed or removed.
    create function app.append_only() returns trigger language plpgsql as $$
    begin
        raise exception '% is append-only', tg_table_name;
    end $$;

    -- A reviewer's correction of one checklist item. The newest per item counts; older ones stay.
    create table review.overrides (
        override_id  bigint generated always as identity primary key,
        run_id       bigint not null references review.runs,
        criterion_id text not null,
        finding      text not null check (finding in ('documented', 'contradicted', 'absent')),
        reason       text not null check (length(btrim(reason)) >= 3),
        user_id      bigint not null references app.users,
        at           timestamptz not null default now()
    );
    create index overrides_by_item on review.overrides (run_id, criterion_id, override_id desc);
    create trigger overrides_append_only before update or delete on review.overrides
        for each row execute function app.append_only();

    create table app.decisions (
        decision_id            bigint generated always as identity primary key,
        case_id                bigint not null references app.cases,
        run_id                 bigint references review.runs,
        outcome                text not null
                               check (outcome in ('approved', 'pended', 'referred', 'denied')),
        reason                 text not null check (length(btrim(reason)) >= 3),
        recommendation         text,       -- what the checklist recommended at that moment
        against_recommendation boolean not null default false,
        user_id                bigint not null references app.users,
        role                   text not null,
        at                     timestamptz not null default now()
    );
    create index decisions_by_case on app.decisions (case_id, decision_id);
    create trigger decisions_append_only before update or delete on app.decisions
        for each row execute function app.append_only();
    -- Only a physician may deny, whatever the application does.
    alter table app.decisions add constraint decisions_deny_by_physician
        check (outcome <> 'denied' or role = 'physician');
    """)


def downgrade() -> None:
    raise NotImplementedError("Roll forward with a new migration instead.")
