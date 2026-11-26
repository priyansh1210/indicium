import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Icon } from "@/components/icons";
import { ApiError, api } from "@/lib/api";
import { PORTAL_STATUS, day, deadline, humanize, moment } from "@/lib/format";
import type { CaseStatus } from "@/lib/types";

import { MoreDocuments } from "./more";

export const metadata: Metadata = { title: "Request" };

type Detail = {
  case: {
    case_id: number;
    external_id: string;
    patient: { member_id: string; name: string; birth_date: string; sex: string };
    procedure_code: string;
    diagnosis_codes: string[];
    urgency: "standard" | "expedited";
    status: CaseStatus;
    requested_by: string;
    received_at: string;
    due_at: string;
    service: string | null;
  };
  documents: { doc_id: string; kind: string; author: string; written_on: string | null; characters: number }[];
  decisions: { outcome: "approved" | "pended" | "denied"; reason: string; role: string; at: string }[];
  timeline: { what: string; at: string }[];
};

// What the practice should expect next, by status.
const NEXT: Partial<Record<CaseStatus, string>> = {
  pended: "The reviewer needs more before deciding. Send the documents below; the request is reviewed again as soon as they arrive.",
  approved: "Approved. Keep the request number with the order.",
  denied:
    "Denied by a physician reviewer, for the reason below. You can ask for a peer-to-peer discussion or appeal through your usual channel.",
};

export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sent?: string }>;
}) {
  const [{ id }, { sent }] = await Promise.all([params, searchParams]);
  let detail: Detail;
  try {
    detail = await api<Detail>(`/portal/requests/${Number(id)}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 422)) notFound();
    throw error;
  }
  const { case: c, documents, decisions, timeline } = detail;
  const status = PORTAL_STATUS[c.status];
  const latest = decisions.at(-1);
  const due = deadline(c.due_at);
  const open = !["approved", "denied"].includes(c.status);

  return (
    <div className="max-w-[1080px] space-y-8">
      <div className="rise">
        <Link href="/portal" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
          <Icon name="back" />
          Requests
        </Link>
        <h1 className="title mt-3">{c.patient.name}</h1>
        <p className="mt-1 text-ink-2">
          <span className="code">{c.external_id}</span> · member <span className="code">{c.patient.member_id}</span> · born{" "}
          {day(c.patient.birth_date)}
        </p>
      </div>

      {sent && (
        <p role="status" className="rise rounded-lg bg-met-soft px-4 py-3 text-sm text-met">
          {sent === "documents"
            ? "Documents sent. The request is being reviewed again with them."
            : `Request sent. A decision is ${due.text}; you get an email when it is made.`}
        </p>
      )}

      <section aria-labelledby="status-heading" className="rise sheet p-5 sm:p-6" style={{ "--i": 1 } as React.CSSProperties}>
        <p className="text-[13px] font-semibold text-ink-2">Status</p>
        <h2 id="status-heading" className={`font-serif text-[28px] font-semibold ${status.tone}`}>
          {status.label}
        </h2>
        <p className="mt-1 max-w-[70ch] text-ink-2">
          {NEXT[c.status] ??
            `A reviewer is checking the notes against the coverage policy. A decision is ${due.text}${
              c.urgency === "expedited" ? " (expedited)" : ""
            }.`}
        </p>
        {latest && (
          <blockquote className="mt-4 border-l-2 border-marker-strong pl-4">
            <p className="text-[13px] font-semibold text-ink-2">
              Reason given · {humanize(latest.role)} reviewer, {moment(latest.at)}
            </p>
            <p className="mt-1 font-serif text-[17px] leading-relaxed whitespace-pre-line">{latest.reason}</p>
          </blockquote>
        )}
      </section>

      {c.status === "pended" && (
        <section aria-labelledby="more-heading" className="rise sheet p-5 sm:p-6" style={{ "--i": 2 } as React.CSSProperties}>
          <h2 id="more-heading" className="font-serif text-[22px] font-semibold">
            Send what was asked for
          </h2>
          <p className="mt-1 mb-5 text-[14px] text-ink-2">Each document is added to the request; nothing sent earlier is replaced.</p>
          <MoreDocuments caseId={c.case_id} />
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="request-heading">
          <h2 id="request-heading" className="font-serif text-[22px] font-semibold">
            The request
          </h2>
          <dl className="mt-3 divide-y divide-rule border-y border-rule text-sm">
            {[
              ["Service", <><span className="code">{c.procedure_code}</span> {c.service ?? "No coverage policy for this code"}</>],
              ["Diagnoses", <span key="dx" className="code">{c.diagnosis_codes.join(", ")}</span>],
              ["Ordered by", c.requested_by],
              ["Urgency", c.urgency === "expedited" ? "Expedited (72 hours)" : "Standard (7 days)"],
              ["Sent", moment(c.received_at)],
              ["Decision due", open ? moment(c.due_at) : "Decided"],
            ].map(([label, value]) => (
              <div key={String(label)} className="grid grid-cols-[8rem_minmax(0,1fr)] gap-4 py-2.5">
                <dt className="text-ink-2">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <h3 className="heading mt-6">Documents sent ({documents.length})</h3>
          {documents.length === 0 ? (
            <p className="mt-2 text-sm text-ink-2">None yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-rule border-y border-rule text-sm">
              {documents.map((d) => (
                <li key={d.doc_id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2.5">
                  <span>
                    <span className="font-semibold capitalize">{humanize(d.kind)}</span>
                    {d.author && <span className="text-ink-2"> · {d.author}</span>}
                  </span>
                  <span className="text-ink-2 tabular-nums">
                    {d.written_on ? day(d.written_on) : "undated"} · {d.characters.toLocaleString()} characters
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="history-heading">
          <h2 id="history-heading" className="font-serif text-[22px] font-semibold">
            History
          </h2>
          <ol className="mt-3 border-l border-rule">
            {timeline.map((t, i) => (
              <li key={i} className="relative pb-5 pl-5 last:pb-0">
                <span
                  aria-hidden="true"
                  className={`absolute top-1.5 -left-[5px] size-[9px] rounded-full border-2 border-canvas ${
                    i === timeline.length - 1 ? "bg-ink" : "bg-ink-3"
                  }`}
                />
                <p className="font-semibold">{t.what}</p>
                <p className="text-[13px] text-ink-2">{moment(t.at)}</p>
              </li>
            ))}
          </ol>
          {decisions.length > 1 && (
            <>
              <h3 className="heading mt-6">Earlier decisions</h3>
              <ul className="mt-2 space-y-3 text-sm">
                {decisions.slice(0, -1).map((d, i) => (
                  <li key={i}>
                    <span className="font-semibold capitalize">{d.outcome}</span>{" "}
                    <span className="text-ink-2">{moment(d.at)}</span>
                    <p className="mt-0.5 text-ink-2">{d.reason}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
