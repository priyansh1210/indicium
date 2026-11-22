"""Policies: immutable, versioned documents with at most one published version each.

Revision ID: 0002
Revises: 0001
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    create schema policy;

    create table policy.versions (
        version_id   bigint generated always as identity primary key,
        policy_id    text not null,
        version      int not null check (version >= 1),
        status       text not null default 'draft'
                     check (status in ('draft', 'published', 'retired')),
        title        text not null,
        document     jsonb not null,       -- the validated policy, criteria and source text
        content_hash text not null,        -- sha256 of the document; the same file loads once
        created_by   text not null,
        created_at   timestamptz not null default now(),
        published_by text,
        published_at timestamptz,
        unique (policy_id, version),
        unique (policy_id, content_hash)
    );
    -- At most one published version per policy, whatever the application does.
    create unique index versions_one_published on policy.versions (policy_id)
        where status = 'published';

    -- A version's content never changes once written: reviews refer to it by id.
    create function policy.reject_content_change() returns trigger language plpgsql as $$
    begin
        if new.document is distinct from old.document
           or new.content_hash is distinct from old.content_hash
           or new.policy_id is distinct from old.policy_id
           or new.version is distinct from old.version then
            raise exception 'policy versions are immutable; load a new version instead';
        end if;
        return new;
    end $$;
    create trigger versions_immutable before update on policy.versions
        for each row execute function policy.reject_content_change();

    create table policy.procedure_codes (
        version_id bigint not null references policy.versions on delete cascade,
        code       text not null,
        primary key (version_id, code)
    );
    create index procedure_codes_code on policy.procedure_codes (code);
    """)


def downgrade() -> None:
    raise NotImplementedError("Roll forward with a new migration instead.")
