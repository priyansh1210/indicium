import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AutoRefresh } from "@/components/auto-refresh";
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

// Filters that narrow the current tab. Each is one query parameter, switched on and off by a link.
const FILTERS = [
  { key: "assigned", value: "me", label: "Mine" },
  { key: "assigned", value: "none", label: "Unassigned" },
  { key: "flagged", value: "true", label: "Flagged" },
  { key: "urgency", value: "expedited", label: "Expedited" },
  { key: "due_within_hours", value: "24", label: "Due in 24 h" },
] as const;

type Params = { view?: string; after?: string; q?: string; sort?: string } & Partial<Record<(typeof FILTERS)[number]["key"], string>>;

export default async function Worklist({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const me = await api<Principal>("/auth/me");
  if (me.role === "provider") redirect("/portal"); // a practice has its own front page
  const fallback = me.role === "physician" ? "referred" : "review";
  const view = VIEWS.find((v) => v.key === params.view) ?? VIEWS.find((v) => v.key === fallback)!;
  const sort = params.sort === "received" ? "received" : "due";

  // The page's own address without one parameter (or with it changed), for the filter links.
  const here = (change: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, after: undefined, ...change })) if (v) next.set(k, v);
    return `/?${next}`;
  };

  const query = new URLSearchParams(view.statuses.map((s) => ["status", s]));
  query.set("limit", "50");
  query.set("sort", sort);
  for (const key of ["after", "q", "assigned", "flagged", "urgency", "due_within_hours"] as const) {
    if (params[key]) query.set(key, params[key]!);
  }
  const [page, summary] = await Promise.all([
    api<{ cases: WorklistRow[]; next: string | null }>(`/cases?${query}`),
    api<{ by_status: Partial<Record<CaseStatus, number>>; overdue: number; mine: number }>("/cases/summary"),
  ]);
  const count = (statuses: CaseStatus[]) => statuses.reduce((total, s) => total + (summary.by_status[s] ?? 0), 0);
  const open = count(OPEN);
  const filtered = FILTERS.some((f) => params[f.key] === f.value) || Boolean(params.q);
  // A view of one status says it in its tab; the column only earns its place when statuses mix.
  const showStatus = view.statuses.length > 1;
  const headings = ["Deadline", "Patient", "Service", "Recommendation", "Flags", "Assigned", ...(showStatus ? ["Status"] : [])];

  return (
    <div className="space-y-6">
      {/* Reviews finish and cases arrive while the list is open; it keeps itself current. */}
      <AutoRefresh seconds={20} />
      <div className="rise flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
        <h1 className="title">Worklist</h1>
        <p className="text-ink-2">
          {open} open {open === 1 ? "case" : "cases"}
          {summary.mine > 0 && <>, {summary.mine} assigned to you</>}
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
              href={here({ view: v.key })}
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

      <div className="rise flex flex-wrap items-center gap-x-6 gap-y-3" style={{ "--i": 2 } as React.CSSProperties}>
        <form role="search" action="/" className="relative w-full sm:w-72">
          <input type="hidden" name="view" value={view.key} />
          {params.sort && <input type="hidden" name="sort" value={params.sort} />}
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-2" />
          <input
            type="search"
            name="q"
            defaultValue={params.q}
            maxLength={100}
            placeholder="Patient, member ID or code"
            aria-label="Search cases"
            className="field h-9 py-0 pl-9"
          />
        </form>
        <div role="group" aria-label="Filters" className="flex flex-wrap gap-x-4 gap-y-2">
          {FILTERS.map((f) => {
            const on = params[f.key] === f.value;
            return (
              <Link
                key={f.label}
                href={here({ [f.key]: on ? undefined : f.value })}
                aria-pressed={on}
                className={`group text-sm font-semibold ${on ? "text-ink" : "text-ink-2 hover:text-ink"}`}
              >
                <span className={`stroke stroke-under ${on ? "" : "[--stroke:var(--color-rule)] group-hover:[background-size:100%_38%]"}`} data-on={on}>
                  {f.label}
                </span>
              </Link>
            );
          })}
        </div>
        <p className="flex items-center gap-2 text-sm text-ink-2 sm:ml-auto">
          Sort
          {(["due", "received"] as const).map((s) => (
            <Link
              key={s}
              href={here({ sort: s === "due" ? undefined : s })}
              aria-current={sort === s ? "true" : undefined}
              className={`rounded-md px-2 py-1 font-semibold ${sort === s ? "bg-paper text-ink shadow-[inset_0_0_0_1px_var(--color-rule)]" : "hover:text-ink"}`}
            >
              {s === "due" ? "Deadline" : "Newest"}
            </Link>
          ))}
        </p>
      </div>

      {page.cases.length === 0 ? (
        <div className="rise sheet bg-tint px-6 py-14 text-center" style={{ "--i": 3 } as React.CSSProperties}>
          <p className="font-serif text-xl font-semibold">{filtered ? "No case matches." : "Nothing here right now."}</p>
          <p className="mt-1 text-ink-2">
            {filtered ? (
              <>
                Nothing {view.label.toLowerCase()} fits the search and filters.{" "}
                <Link href={`/?view=${view.key}`} className="font-semibold text-accent hover:underline">
                  Clear them
                </Link>
              </>
            ) : (
              <>No cases are {view.label.toLowerCase()}. New requests appear in Ready for nurse once their automated review finishes.</>
            )}
          </p>
        </div>
      ) : (
        <div className="sheet overflow-hidden">
          <table className="w-full text-left text-sm md:min-w-[960px]">
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
                const mine = row.assigned_to === me.user_id;
                return (
                  <tr
                    key={row.case_id}
                    className="rise relative border-b border-rule transition-colors duration-150 last:border-0 hover:bg-tint hover:shadow-[inset_3px_0_0_var(--color-marker-strong)] max-md:grid max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-2 max-md:px-4 max-md:py-4"
                    style={{ "--i": i + 3 } as React.CSSProperties}
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
                    <td className="px-4 py-3.5 align-top max-md:order-6 max-md:p-0 max-md:empty:hidden">
                      {row.assigned_name && <span className={mine ? "font-semibold" : ""}>{mine ? "You" : row.assigned_name}</span>}
                    </td>
                    {showStatus && (
                      <td className="px-4 py-3.5 align-top text-ink-2 max-md:order-7 max-md:p-0">{STATUS_LABEL[row.status]}</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {page.next && (
        <Link href={here({ after: page.next })} className="btn">
          Next page
        </Link>
      )}
    </div>
  );
}
