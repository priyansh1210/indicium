import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { RecommendationText } from "@/components/badges";
import { Deadline } from "@/components/deadline";
import { Icon } from "@/components/icons";
import { api } from "@/lib/api";
import { STATUS_LABEL } from "@/lib/format";
import type { CaseStatus, Principal, WorklistRow } from "@/lib/types";

export const metadata: Metadata = { title: "Worklist" };

const VIEWS: { key: string; label: string; statuses: CaseStatus[] }[] = [
  { key: "review", label: "Ready for nurse", statuses: ["awaiting_nurse"] },
  { key: "referred", label: "With physician", statuses: ["referred"] },
  { key: "pended", label: "Pended", statuses: ["pended"] },
  { key: "processing", label: "In progress", statuses: ["received", "queued", "in_review"] },
  { key: "failed", label: "Review failed", statuses: ["failed"] },
  { key: "decided", label: "Decided", statuses: ["approved", "denied"] },
];
const OPEN: CaseStatus[] = ["received", "queued", "in_review", "awaiting_nurse", "failed", "pended", "referred"];

const FLAG_SHORT: Record<string, string> = {
  possible_injection: "Suspicious text",
  diagnosis_not_covered: "Diagnosis not covered",
  conflicting_evidence: "Notes disagree",
  low_confidence: "Low confidence",
  approval_concern: "Reason against approval",
};

export default async function Worklist({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; after?: string }>;
}) {
  const { view: requested, after } = await searchParams;
  const me = await api<Principal>("/auth/me");
  if (me.role === "provider") redirect("/portal"); // a practice has its own front page
  const fallback = me.role === "physician" ? "referred" : "review";
  const view = VIEWS.find((v) => v.key === requested) ?? VIEWS.find((v) => v.key === fallback)!;
  const query = new URLSearchParams(view.statuses.map((s) => ["status", s]));
  query.set("limit", "50");
  if (after) query.set("after", after);
  const [page, summary] = await Promise.all([
    api<{ cases: WorklistRow[]; next: string | null }>(`/cases?${query}`),
    api<{ by_status: Partial<Record<CaseStatus, number>>; overdue: number }>("/cases/summary"),
  ]);
  const count = (statuses: CaseStatus[]) => statuses.reduce((total, s) => total + (summary.by_status[s] ?? 0), 0);
  const open = count(OPEN);
  // A view of one status says it in its tab; the column only earns its place when statuses mix.
  const showStatus = view.statuses.length > 1;
  const headings = ["Deadline", "Patient", "Service", "Recommendation", "Flags", ...(showStatus ? ["Status"] : [])];

  return (
    <div className="space-y-7">
      <div className="rise flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
        <h1 className="title">Worklist</h1>
        <p className="text-ink-2">
          {open} open {open === 1 ? "case" : "cases"}, soonest deadline first
          {summary.overdue > 0 && (
            <span className="ml-3 inline-flex items-center gap-1.5 font-semibold text-unmet">
              <Icon name="clock" />
              {summary.overdue} past the deadline
            </span>
          )}
        </p>
      </div>

      <nav aria-label="Case status" className="rise -mx-4 flex gap-1 overflow-x-auto border-b border-rule px-4 after:block after:w-4 after:shrink-0 sm:mx-0 sm:px-0 sm:after:hidden" style={{ "--i": 1 } as React.CSSProperties}>
        {VIEWS.map((v) => {
          const current = v.key === view.key;
          const n = count(v.statuses);
          return (
            <Link
              key={v.key}
              href={`/?view=${v.key}`}
              aria-current={current ? "page" : undefined}
              className={`group -mb-px flex h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold ${
                current ? "border-ink text-ink" : "border-transparent text-ink-2 hover:text-ink"
              }`}
            >
              {v.label}
              <span className={`tabular-nums ${n ? "" : "font-normal"} ${current ? "text-ink" : "text-ink-2"}`}>{n}</span>
            </Link>
          );
        })}
      </nav>

      {page.cases.length === 0 ? (
        <div className="rise sheet bg-tint px-6 py-14 text-center" style={{ "--i": 2 } as React.CSSProperties}>
          <p className="font-serif text-xl font-semibold">Nothing here right now.</p>
          <p className="mt-1 text-ink-2">
            No cases are {view.label.toLowerCase()}. New requests appear in Ready for nurse once their automated review finishes.
          </p>
        </div>
      ) : (
        <div className="sheet overflow-hidden">
          <table className="w-full text-left text-sm md:min-w-[860px]">
            <thead className="border-b border-rule text-ink-2 max-md:hidden">
              <tr>
                {headings.map((h) => (
                  <th key={h} scope="col" className="px-4 py-3 text-[13px] font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.cases.map((row, i) => {
                const closed = row.status === "approved" || row.status === "denied";
                return (
                  <tr
                    key={row.case_id}
                    className="rise relative border-b border-rule transition-colors duration-150 last:border-0 hover:bg-tint hover:shadow-[inset_3px_0_0_var(--color-marker-strong)] max-md:grid max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-2 max-md:px-4 max-md:py-4"
                    style={{ "--i": i + 2 } as React.CSSProperties}
                  >
                    <td className="px-4 py-3.5 align-top max-md:order-2 max-md:p-0">
                      <Deadline receivedAt={row.received_at} dueAt={row.due_at} closed={closed} />
                      {row.urgency === "expedited" && (
                        <span className="mt-1.5 inline-block text-[12px] font-semibold text-accent">Expedited</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 align-top max-md:order-1 max-md:col-span-2 max-md:p-0">
                      <Link
                        href={`/cases/${row.case_id}`}
                        className="font-serif text-[17px] font-semibold after:absolute after:inset-0 hover:underline focus-visible:underline"
                      >
                        {row.patient_name}
                      </Link>
                      <span className="code block text-ink-2">{row.external_id}</span>
                    </td>
                    <td className="px-4 py-3.5 align-top max-md:order-3 max-md:p-0">
                      <span className="code">{row.procedure_code}</span>
                      <span className="block text-ink-2">{row.policy_title ?? "No policy for this code"}</span>
                    </td>
                    <td className="px-4 py-3.5 align-top max-md:order-4 max-md:p-0">
                      <RecommendationText value={row.recommendation} />
                    </td>
                    <td className="px-4 py-3.5 align-top max-md:order-5 max-md:col-span-2 max-md:p-0 max-md:empty:hidden">
                      {row.flags?.length ? (
                        <ul className="space-y-0.5">
                          {row.flags.map((f) => (
                            <li key={f} className="flex items-center gap-1.5 text-[13px] font-semibold text-unmet">
                              <Icon name={f === "possible_injection" ? "shield" : "warning"} className="size-3.5" />
                              {FLAG_SHORT[f] ?? f}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                    {showStatus && (
                      <td className="px-4 py-3.5 align-top text-ink-2 max-md:order-6 max-md:p-0">{STATUS_LABEL[row.status]}</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {page.next && (
        <Link href={`/?view=${view.key}&after=${encodeURIComponent(page.next)}`} className="btn">
          Next page
        </Link>
      )}
    </div>
  );
}
