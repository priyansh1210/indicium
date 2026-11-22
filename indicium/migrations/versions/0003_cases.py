"""Cases and their documents, with status changes checked by the database.

Revision ID: 0003
Revises: 0002
"""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    create schema app;

    create table app.cases (
        case_id         bigint generated always as identity primary key,
        external_id     text not null unique,     -- submitter's id; a resubmit returns the case
        request_hash    text not null,            -- sha256 of the request as received
        patient         jsonb not null,
        procedure_code  text not null,
        diagnosis_codes text[] not null,
        urgency         text not null check (urgency in ('standard', 'expedited')),
        requested_by    text not null,
        status          text not null default 'received',
        received_at     timestamptz not null default now(),
        due_at          timestamptz not null,     -- the decision deadline for this urgency
        updated_at      timestamptz not null default now(),
        created_by      text not null
    );
    create index cases_worklist on app.cases (status, due_at);

    create table app.documents (
        case_id    bigint not null references app.cases,
        doc_id     text not null,
        kind       text not null,
        author     text not null default '',
        written_on date,
        text       text not null,
        sha256     text not null,
        primary key (case_id, doc_id)
    );

    -- Allowed status changes. Anything else is refused, whichever code path tries it.
    --   received -> queued -> in_review -> awaiting_nurse -> approved | pended | referred
    --   referred -> approved | denied | pended      (physician decision)
    --   pended -> queued                            (new information arrived)
    --   in_review -> queued | failed; failed -> queued   (worker lost or error; retry)
    --   awaiting_nurse -> queued                    (re-run after a policy or note change)
    create table app.case_transitions (
        from_status text not null,
        to_status   text not null,
        primary key (from_status, to_status)
    );
    insert into app.case_transitions values
        ('received', 'queued'),
        ('queued', 'in_review'),
        ('in_review', 'awaiting_nurse'), ('in_review', 'queued'), ('in_review', 'failed'),
        ('failed', 'queued'),
        ('awaiting_nurse', 'approved'), ('awaiting_nurse', 'pended'),
        ('awaiting_nurse', 'referred'), ('awaiting_nurse', 'queued'),
        ('referred', 'approved'), ('referred', 'denied'), ('referred', 'pended'),
        ('pended', 'queued');

    alter table app.cases add constraint cases_status_known check (status in (
        'received', 'queued', 'in_review', 'awaiting_nurse', 'failed',
        'pended', 'referred', 'approved', 'denied'));

    create function app.check_case_transition() returns trigger language plpgsql as $$
    begin
        if new.status is distinct from old.status and not exists (
            select 1 from app.case_transitions
            where from_status = old.status and to_status = new.status
        ) then
            raise exception 'case % cannot move from % to %', old.case_id, old.status, new.status;
        end if;
        new.updated_at := now();
        return new;
    end $$;
    create trigger cases_transition before update on app.cases
        for each row execute function app.check_case_transition();
    """)


def downgrade() -> None:
    raise NotImplementedError("Roll forward with a new migration instead.")
