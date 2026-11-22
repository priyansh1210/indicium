"""Review runs (also the work queue) and their per-criterion findings.

Revision ID: 0004
Revises: 0003
"""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    create schema review;

    -- One row per automated review of a case. Queued rows are the work queue: workers claim them
    -- with "for update skip locked", so any number of workers can run without coordinating.
    create table review.runs (
        run_id            bigint generated always as identity primary key,
        case_id           bigint not null references app.cases,
        status            text not null default 'queued'
                          check (status in ('queued', 'running', 'done', 'failed')),
        attempts          int not null default 0,
        available_at      timestamptz not null default now(),   -- retry backoff
        lease_until       timestamptz,       -- a running row whose lease passed is claimed again
        due_at            timestamptz not null,                 -- copied from the case: earliest first
        requested_by      text not null,
        created_at        timestamptz not null default now(),
        started_at        timestamptz,
        finished_at       timestamptz,
        provider          text,
        model             text,
        prompt_version    text,
        policy_version_id bigint references policy.versions,
        recommendation    text check (recommendation in
                          ('meets_criteria', 'pend_for_info', 'refer_to_clinician')),
        reasons           jsonb,
        flags             text[],
        tokens_in         int,
        tokens_out        int,
        latency_ms        int,
        error             text,
        detail            jsonb not null default '{}'
    );
    -- At most one queued or running review per case: enqueueing twice is harmless.
    create unique index runs_one_active on review.runs (case_id)
        where status in ('queued', 'running');
    create index runs_claimable on review.runs (due_at) where status in ('queued', 'running');
    create index runs_by_case on review.runs (case_id, run_id desc);

    create table review.findings (
        run_id       bigint not null references review.runs,
        criterion_id text not null,
        finding      text not null
                     check (finding in ('documented', 'contradicted', 'absent', 'conflicting')),
        confidence   real not null check (confidence between 0 and 1),
        rationale    text not null default '',
        evidence     jsonb not null default '[]',  -- [{doc_id, quote, start, end}], quotes verified
        dropped      jsonb not null default '[]',  -- quotes the model gave that were not in the notes
        primary key (run_id, criterion_id)
    );
    """)


def downgrade() -> None:
    raise NotImplementedError("Roll forward with a new migration instead.")
