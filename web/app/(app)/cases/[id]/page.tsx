import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/auto-refresh";
import { Deadline } from "@/components/deadline";
import { Icon } from "@/components/icons";
import { ApiError, api } from "@/lib/api";
import { STATUS_LABEL, day, humanize, moment } from "@/lib/format";
import type { AuditEvent, CaseDetail, Principal } from "@/lib/types";

import { Assignment, type Reviewer } from "./assignment";
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

const OUTCOME_TONE: Record<string, string> = {
  approved: "text-met",
  denied: "text-unmet",
  pended: "text-missing",
  referred: "text-accent",
};

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, audit, me] = await load(id);
  const c = detail.case;
  const closed = c.status === "approved" || c.status === "denied";
  const reviewing = ["received", "queued", "in_review"].includes(c.status);
  const reviewers = me.role === "supervisor" ? await api<Reviewer[]>("/cases/reviewers") : null;

  return (
    <div className="space-y-8">
      {/* While the automated review runs, the page follows it and shows the checklist when done. */}
      {reviewing && <AutoRefresh seconds={3} />}
      <Link href="/" className="group inline-flex items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        <Icon name="back" className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
        Worklist
      </Link>

      <header className="rise space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <div>
            <h1 className="title text-[clamp(30px,3.4vw,40px)]">{c.patient.name}</h1>
            <p className="mt-1.5 text-ink-2">
              <span className="code">{c.patient.member_id}</span> · born {day(c.patient.birth_date)} · {c.patient.sex}
            </p>
          </div>
          <div className="min-w-44 text-sm sm:text-right">
            <p className="font-semibold">
              {STATUS_LABEL[c.status]}
              {c.urgency === "expedited" && <span className="ml-2 font-semibold text-accent">· Expedited</span>}
            </p>
            {!closed && <Deadline receivedAt={c.received_at} dueAt={c.due_at} closed={false} className="mt-1.5 sm:[&>span:last-child]:ml-auto" />}
            <div className="mt-3">
              <Assignment detail={detail} me={me} reviewers={reviewers} />
            </div>
          </div>
        </div>
        <dl className="grid gap-x-10 gap-y-4 border-y border-rule py-4 text-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
          <div>
            <dt className="text-[13px] text-ink-2">Service</dt>
            <dd className="mt-0.5">
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
                      className="ml-2 inline-flex items-center gap-0.5 font-semibold text-accent hover:underline"
                    >
                      {detail.policy.source.document_id}
                      <Icon name="external" className="size-3.5" />
                    </a>
                  )}
                </>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-ink-2">Diagnoses</dt>
            <dd className="code mt-0.5">{c.diagnosis_codes.join(", ")}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-ink-2">Requested by</dt>
            <dd className="mt-0.5">
              {c.requested_by} · received {moment(c.received_at)}
            </dd>
          </div>
        </dl>
      </header>

      {detail.decisions.length > 0 && (
        <section aria-labelledby="decisions-heading" className="rise">
          <h2 id="decisions-heading" className="heading">
            Decisions
          </h2>
          <ol className="mt-3 space-y-3">
            {detail.decisions.map((d) => (
              <li key={d.decision_id} className="border-l-2 border-ink pl-4">
                <p>
                  <strong className={`capitalize ${OUTCOME_TONE[d.outcome] ?? ""}`}>{d.outcome}</strong> by {d.by_name} ({d.role}),{" "}
                  <span className="text-ink-2">{moment(d.at)}</span>
                  {d.against_recommendation && (
                    <span className="ml-2 text-[13px] font-semibold text-missing">against the recommendation</span>
                  )}
                </p>
                <p className="mt-0.5 text-ink-2">{d.reason}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      <CaseReview detail={detail} me={me} />

      <details className="group border-t border-rule pt-5">
        <summary className="heading flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
          <Icon name="history" className="size-4" />
          Audit trail ({audit.length} events)
          <span className="text-ink-2 transition-transform duration-200 group-open:rotate-90">›</span>
        </summary>
        <ol className="mt-4 ml-2 border-l border-rule text-sm">
          {audit.map((e) => (
            <li key={e.event_id} className="relative grid gap-x-6 py-1.5 pl-5 sm:grid-cols-[140px_220px_1fr]">
              <span className="absolute top-[13px] -left-[3.5px] size-1.5 rounded-full bg-ink-2" aria-hidden="true" />
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
