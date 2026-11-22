import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Icon } from "@/components/icons";
import { ApiError, api } from "@/lib/api";
import { STATUS_LABEL, day, deadline, humanize, moment } from "@/lib/format";
import type { AuditEvent, CaseDetail, Principal } from "@/lib/types";

import { CaseReview } from "./review";

export const metadata: Metadata = { title: "Case" };

async function load(id: string) {
  if (!/^\d+$/.test(id)) notFound();
  try {
    return await Promise.all([
      api<CaseDetail>(`/cases/${id}`),
      api<AuditEvent[]>(`/cases/${id}/audit`),
      api<Principal>("/auth/me"),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, audit, me] = await load(id);
  const c = detail.case;
  const closed = c.status === "approved" || c.status === "denied";
  const due = deadline(c.due_at);

  return (
    <div className="space-y-5">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
        <Icon name="back" />
        Worklist
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="title">{c.patient.name}</h1>
          <p className="mt-1 text-ink-2">
            <span className="code">{c.patient.member_id}</span> · born {day(c.patient.birth_date)} · {c.patient.sex}
          </p>
          <dl className="mt-3 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-ink-2">Service</dt>
            <dd>
              <span className="code">{c.procedure_code}</span>
              {detail.policy && (
                <>
                  {" "}
                  · {detail.policy.title}
                  {detail.policy.source.url && (
                    <a
                      href={detail.policy.source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 inline-flex items-center gap-0.5 text-accent hover:underline"
                    >
                      {detail.policy.source.document_id}
                      <Icon name="external" className="size-3.5" />
                    </a>
                  )}
                </>
              )}
            </dd>
            <dt className="text-ink-2">Diagnoses</dt>
            <dd className="code">{c.diagnosis_codes.join(", ")}</dd>
            <dt className="text-ink-2">Requested by</dt>
            <dd>
              {c.requested_by} · received {moment(c.received_at)}
            </dd>
          </dl>
        </div>
        <div className="sm:text-right">
          <p className="text-sm font-semibold">{STATUS_LABEL[c.status]}</p>
          {!closed && (
            <p className={`mt-1 flex items-center gap-1 sm:justify-end text-sm ${due.overdue ? "font-semibold text-unmet" : "text-ink-2"}`}>
              <Icon name="clock" />
              Decision {due.text}
            </p>
          )}
          {c.urgency === "expedited" && (
            <p className="mt-1 inline-block rounded bg-accent-soft px-2 py-0.5 text-[13px] font-semibold text-accent">Expedited</p>
          )}
        </div>
      </header>

      {detail.decisions.length > 0 && (
        <section className="sheet p-5" aria-labelledby="decisions-heading">
          <h2 id="decisions-heading" className="heading">
            Decisions
          </h2>
          <ol className="mt-2 space-y-2">
            {detail.decisions.map((d) => (
              <li key={d.decision_id} className="text-sm">
                <strong className="capitalize">{d.outcome}</strong> by {d.by_name} ({d.role}), {moment(d.at)}: {d.reason}
                {d.against_recommendation && (
                  <span className="ml-2 rounded bg-missing-soft px-1.5 py-0.5 text-[12px] font-semibold text-missing">
                    against the recommendation
                  </span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      <CaseReview detail={detail} me={me} />

      <details className="sheet p-5">
        <summary className="heading cursor-pointer">
          <Icon name="history" className="mr-1 inline size-4" />
          Audit trail ({audit.length} events)
        </summary>
        <ol className="mt-3 space-y-1.5 text-sm">
          {audit.map((e) => (
            <li key={e.event_id} className="grid gap-x-4 sm:grid-cols-[150px_220px_1fr]">
              <span className="text-ink-2 tabular-nums">{moment(e.at)}</span>
              <span className="truncate">{e.actor}</span>
              <span>
                {humanize(e.action.replace(".", " "))}
                {typeof e.detail.reason === "string" && <span className="text-ink-2"> · {e.detail.reason}</span>}
              </span>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
