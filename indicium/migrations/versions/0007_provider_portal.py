"""Provider portal: practices register, their people submit and follow their own requests.

Revision ID: 0007
Revises: 0006
"""

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    -- A practice that sends requests, identified by its National Provider Identifier.
    create table app.organizations (
        organization_id bigint generated always as identity primary key,
        name            text not null,
        npi             text not null unique check (npi ~ '^[0-9]{10}$'),
        created_at      timestamptz not null default now(),
        created_ip      text   -- caps how many practices one address can register
    );
    create index organizations_by_ip on app.organizations (created_ip, created_at);

    alter table app.users drop constraint users_role_check;
    alter table app.users add constraint users_role_check
        check (role in ('viewer', 'nurse', 'physician', 'supervisor', 'admin', 'provider'));
    alter table app.users add column organization_id bigint references app.organizations;
    -- A provider always belongs to a practice; reviewing staff never do.
    alter table app.users add constraint users_provider_has_practice
        check ((role = 'provider') = (organization_id is not null));

    -- The practice whose people submitted a case: they, and only they, follow it in the portal.
    alter table app.cases add column organization_id bigint references app.organizations;
    create index cases_by_practice on app.cases (organization_id, received_at desc)
        where organization_id is not null;
    """)


def downgrade() -> None:
    raise NotImplementedError("Roll forward with a new migration instead.")
