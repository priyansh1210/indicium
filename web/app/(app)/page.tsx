import type { Metadata } from "next";
import Link from "next/link";

import { RecommendationText } from "@/components/badges";
import { Icon } from "@/components/icons";
import { api } from "@/lib/api";
import { STATUS_LABEL, deadline } from "@/lib/format";
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
  const fallback = me.role === "physician" ? "referred" : "review";
  const view = VIEWS.find((v) => v.key === requested) ?? VIEWS.find((v) => v.key === fallback)!;
  const query = new URLSearchParams(view.statuses.map((s) => ["status", s]));
  query.set("limit", "50");
  if (after) query.set("after", after);
  const [page, summary] = await Promise.all([
    api<{ cases: WorklistRow[]; next: string | null }>(`/cases?${query}`),
    api<{ by_status: Partial<Record<CaseStatus, number>>; overdue: number }>("/cases/summary"),
  ]);
  const count = (v: (typeof VIEWS)[number]) =>
    v.statuses.reduce((total, s) => total + (summary.by_status[s] ?? 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="title">Worklist</h1>
          <p className="mt-1 text-ink-2">Soonest deadline first.</p>
        </div>
        {summary.overdue > 0 && (
          <p className="flex items-center gap-1.5 rounded-lg bg-unmet-soft px-3 py-1.5 text-sm font-semibold text-unmet">
            <Icon name="clock" />
            {summary.overdue} open {summary.overdue === 1 ? "case is" : "cases are"} past the deadline
          </p>
        )}
      </div>

      <nav aria-label="Case status" className="flex gap-1 overflow-x-auto pb-1">
        {VIEWS.map((v) => {
          const current = v.key === view.key;
          return (
            <Link
              key={v.key}
              href={`/?view=${v.key}`}
              aria-current={current ? "page" : undefined}
              className={`flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold ${
                current ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper hover:text-ink"
              }`}
            >
              {v.label}
              <span className={`tabular-nums ${current ? "text-paper/75" : "text-ink-2"}`}>{count(v)}</span>
            </Link>
          );
        })}
      </nav>

      <div className="sheet overflow-hidden">
        {page.cases.length === 0 ? (
          <p className="bg-tint px-6 py-12 text-center text-ink-2">No cases are {view.label.toLowerCase()} right now.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-rule text-ink-2">
                <tr>
                  {["Deadline", "Patient", "Service", "Recommendation", "Flags", "Status"].map((h) => (
                    <th key={h} scope="col" className="px-4 py-3 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.cases.map((row) => {
                  const due = deadline(row.due_at);
                  const closed = row.status === "approved" || row.status === "denied";
                  return (
                    <tr key={row.case_id} className="border-b border-rule last:border-0 hover:bg-tint">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={due.overdue && !closed ? "font-semibold text-unmet" : ""}>
                          {closed ? "Closed" : due.text}
                        </span>
                        {row.urgency === "expedited" && (
                          <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-[12px] font-semibold text-accent">
                            Expedited
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/cases/${row.case_id}`} className="font-semibold text-accent hover:underline">
                          {row.patient_name}
                        </Link>
                        <span className="code block text-ink-2">{row.external_id}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="code">{row.procedure_code}</span>
                        <span className="block text-ink-2">{row.policy_title ?? "—"}</span>
                      </td>
                      <td className="px-4 py-3">
                        <RecommendationText value={row.recommendation} />
                      </td>
                      <td className="px-4 py-3">
                        {row.flags?.length ? (
                          <ul className="space-y-0.5">
                            {row.flags.map((f) => (
                              <li key={f} className="flex items-center gap-1 text-[13px] text-unmet">
                                <Icon name={f === "possible_injection" ? "shield" : "warning"} className="size-3.5" />
                                {FLAG_SHORT[f] ?? f}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-ink-2">None</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-ink-2">{STATUS_LABEL[row.status]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {page.next && (
        <Link href={`/?view=${view.key}&after=${encodeURIComponent(page.next)}`} className="btn">
          Next page
        </Link>
      )}
    </div>
  );
}
