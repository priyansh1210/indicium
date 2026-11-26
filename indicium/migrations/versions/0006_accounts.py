"""Accounts: invitations, password resets, email verification, a second factor, an email outbox.

Revision ID: 0006
Revises: 0005
"""

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    -- An invited person has no password until they open their invitation.
    alter table app.users alter column password_hash drop not null;
    alter table app.users add column email_verified_at timestamptz;
    update app.users set email_verified_at = created_at;
    alter table app.users add column last_login_at timestamptz;
    -- Time-based one-time codes (RFC 6238). pending holds a secret until its first code is shown.
    alter table app.users add column totp_secret text;
    alter table app.users add column totp_pending text;
    alter table app.users add column totp_last_step bigint; -- a code is accepted once
    alter table app.users drop constraint users_role_check;
    alter table app.users add constraint users_role_check
        check (role in ('viewer', 'nurse', 'physician', 'supervisor', 'admin'));

    -- One-use links sent by email. Only the hash is stored, like session tokens.
    create table app.account_tokens (
        token_hash text primary key,
        user_id    bigint not null references app.users on delete cascade,
        purpose    text not null check (purpose in ('invite', 'reset', 'verify')),
        created_by text not null,
        created_at timestamptz not null default now(),
        expires_at timestamptz not null,
        used_at    timestamptz
    );
    create index account_tokens_by_user on app.account_tokens (user_id, purpose, created_at);

    -- Email is written here in the same transaction as the change that causes it, and sent by a
    -- background loop. A failed send is retried; a sent message keeps no body (no live links).
    create table app.outbox (
        message_id   bigint generated always as identity primary key,
        to_email     text not null,
        subject      text not null,
        body         text not null,
        created_at   timestamptz not null default now(),
        available_at timestamptz not null default now(),
        attempts     int not null default 0,
        sent_at      timestamptz,
        error        text
    );
    create index outbox_pending on app.outbox (available_at) where sent_at is null;
    """)


def downgrade() -> None:
    raise NotImplementedError("Roll forward with a new migration instead.")
