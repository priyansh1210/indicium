import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/auto-refresh";
import { DailyColumns, MeterList, type Day } from "@/components/charts";
import { Icon } from "@/components/icons";
import { api } from "@/lib/api";
import { RECOMMENDATION_LABEL, STATUS_LABEL } from "@/lib/format";
import type { CaseStatus, Principal, Recommendation, Role } from "@/lib/types";

export const metadata: Metadata = { title: "Dashboard" };

type Outcome = "approved" | "pended" | "referred" | "denied";
type Board = {
  days: number;
  queue: { open: number; overdue: number; due_soon: number; unassigned: number };
  stages: Partial<Record<CaseStatus, number>>;
  per_day: { day: string; outcome: Outcome; n: number }[];
  timeliness: { decided: number; on_time: number; median_hours: number | null };
  agreement: { cells: { recommendation: Recommendation; outcome: Outcome; n: number }[]; matched: number; total: number };
  reviewers: { user_id: number; name: string; role: Role; open_cases: number; decisions: number; against: number; denied: number }[];
  engine: { done: number; failed: number; waiting: number; flagged: number; median_ms: number | null; tokens: number };
};

const RANGES = [7, 30, 90];
const OUTCOMES: { key: Outcome; label: string }[] = [
  { key: "approved", label: "Approved" },
  { key: "pended", label: "Pended" },
  { key: "referred", label: "Referred" },
  { key: "denied", label: "Denied" },
];
const STAGES: CaseStatus[] = ["received", "queued", "in_review", "failed", "awaiting_nurse", "referred", "pended"];
const RECOMMENDATIONS: Recommendation[] = ["meets_criteria", "pend_for_info", "refer_to_clinician"];
const EXPECTED: Record<Recommendation, Outcome> = {
  meets_criteria: "approved",
  pend_for_info: "pended",
  refer_to_clinician: "referred",
};

const percent = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "–");
function hours(h: number | null): string {
  if (h === null) return "–";
  return h < 48 ? `${h < 10 ? h.toFixed(1) : Math.round(h)} h` : `${(h / 24).toFixed(1)} d`;
}

function Tile({ label, value, note, tone = "" }: { label: string; value: string | number; note?: React.ReactNode; tone?: string }) {
  return (
    <div className="sheet px-4 py-3.5">
      <p className="text-[13px] text-ink-2">{label}</p>
      <p className={`mt-0.5 text-[28px] leading-tight font-semibold ${tone}`}>{value}</p>
      {note && <p className="mt-0.5 text-[13px] text-ink-2">{note}</p>}
    </div>
  );
}

function Panel({ title, about, children, className = "" }: { title: string; about?: string; children: React.ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`sheet p-5 ${className}`}>
      <h2 className="font-serif text-[20px] font-semibold">{title}</h2>
      {about && <p className="mt-0.5 text-[13px] text-ink-2">{about}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const me = await api<Principal>("/auth/me");
  if (me.role !== "supervisor" && me.role !== "admin") notFound();
  const { days: asked } = await searchParams;
  const days = RANGES.includes(Number(asked)) ? Number(asked) : 30;
  const b = await api<Board>(`/dashboard?days=${days}`);

  const byDay = new Map<string, Day>();
  for (const row of b.per_day) {
    const day = byDay.get(row.day) ?? { day: row.day, total: 0, parts: [] };
    day.total += row.n;
    day.parts.push({ label: OUTCOMES.find((o) => o.key === row.outcome)!.label, n: row.n });
    byDay.set(row.day, day);
  }
  const series = [...byDay.values()];
  const totals = OUTCOMES.map((o) => ({ label: o.label, n: b.per_day.filter((r) => r.outcome === o.key).reduce((s, r) => s + r.n, 0) }));
  const decisions = totals.reduce((s, t) => s + t.n, 0);
  const cell = (r: Recommendation, o: Outcome) => b.agreement.cells.find((c) => c.recommendation === r && c.outcome === o)?.n ?? 0;
  const rowTotal = (r: Recommendation) => OUTCOMES.reduce((s, o) => s + cell(r, o.key), 0);
  const cellMax = Math.max(...b.agreement.cells.map((c) => c.n), 1);
  // People with nothing open and nothing decided in the period are counted, not listed.
  const busy = b.reviewers.filter((r) => r.open_cases || r.decisions);
  const idle = b.reviewers.length - busy.length;

  return (
    <div className="space-y-6">
      <AutoRefresh seconds={30} />
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <h1 className="title">Dashboard</h1>
        <nav aria-label="Period" className="flex items-center gap-2 text-sm text-ink-2">
          Last
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`/dashboard?days=${r}`}
              aria-current={r === days ? "true" : undefined}
              className={`rounded-md px-2 py-1 font-semibold ${r === days ? "bg-paper text-ink shadow-[inset_0_0_0_1px_var(--color-rule)]" : "hover:text-ink"}`}
            >
              {r} days
            </Link>
          ))}
        </nav>
      </div>

      <div className="rise grid grid-cols-2 gap-3 lg:grid-cols-5" style={{ "--i": 1 } as React.CSSProperties}>
        <Tile label="Open cases" value={b.queue.open} note={<Link href="/" className="hover:text-ink hover:underline">Open the worklist</Link>} />
        <Tile
          label="Past the deadline"
          value={b.queue.overdue}
          tone={b.queue.overdue ? "text-unmet" : ""}
          note={b.queue.overdue ? <span className="inline-flex items-center gap-1 text-unmet"><Icon name="clock" className="size-3.5" />Needs a decision now</span> : "None overdue"}
        />
        <Tile label="Due in 24 hours" value={b.queue.due_soon} tone={b.queue.due_soon ? "text-missing" : ""} />
        <Tile label="Unassigned" value={b.queue.unassigned} note={<Link href="/?assigned=none" className="hover:text-ink hover:underline">Hand them out</Link>} />
        <Tile
          label="Decided on time"
          value={percent(b.timeliness.on_time, b.timeliness.decided)}
          note={`${b.timeliness.on_time} of ${b.timeliness.decided}, median ${hours(b.timeliness.median_hours)}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:items-start">
        <Panel title="Decisions per day" about={`${decisions} in the last ${days} days, referrals included. Point at a day for its outcomes.`}>
          <DailyColumns days={series} label={`Decisions per day over the last ${days} days`} />
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-[13px] font-semibold text-ink-2 hover:text-ink">Show as a table</summary>
            <div className="mt-2 max-h-64 overflow-auto">
              <table className="w-full text-left tabular-nums">
                <thead className="text-[12px] text-ink-2">
                  <tr>
                    <th scope="col" className="py-1 font-semibold">Day</th>
                    {OUTCOMES.map((o) => <th key={o.key} scope="col" className="py-1 text-right font-semibold">{o.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {series.filter((d) => d.total > 0).map((d) => (
                    <tr key={d.day} className="border-t border-rule">
                      <td className="py-1">{d.day}</td>
                      {d.parts.map((p) => <td key={p.label} className="py-1 text-right">{p.n}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Panel>
        <Panel title="Outcomes" about={`Every decision in the last ${days} days.`}>
          <MeterList rows={[...totals].sort((a, z) => z.n - a.n)} unit="decisions" />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Open cases by stage" about="In the order a case moves through review.">
          <MeterList rows={STAGES.map((s) => ({ label: STATUS_LABEL[s], n: b.stages[s] ?? 0 }))} unit="cases" />
        </Panel>
        <Panel
          title="Recommendation and decision"
          about={
            b.agreement.total
              ? `Reviewers followed the recommendation in ${percent(b.agreement.matched, b.agreement.total)} of ${b.agreement.total} decisions. The darker a cell, the more decisions it holds.`
              : "No decisions yet in this period."
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[320px] text-sm tabular-nums">
              <thead className="text-[12px] text-ink-2">
                <tr>
                  <th scope="col" className="pb-2 text-left font-semibold">Recommended</th>
                  {OUTCOMES.map((o) => <th key={o.key} scope="col" className="px-1 pb-2 text-center font-semibold">{o.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {RECOMMENDATIONS.map((r) => (
                  <tr key={r}>
                    <th scope="row" className="py-1 pr-3 text-left font-normal">
                      {RECOMMENDATION_LABEL[r]}
                      <span className="block text-[12px] text-ink-2">{rowTotal(r)} decisions</span>
                    </th>
                    {OUTCOMES.map((o) => {
                      const n = cell(r, o.key);
                      const expected = EXPECTED[r] === o.key;
                      return (
                        <td key={o.key} className="p-0.5">
                          <span
                            className={`flex h-10 items-center justify-center rounded-md text-ink ${expected ? "ring-1 ring-ink/30 ring-inset" : ""}`}
                            // At most 55% of the chart hue, so ink stays AA on every cell in both themes.
                            style={{ backgroundColor: n ? `color-mix(in oklab, var(--color-chart) ${Math.round(8 + (n / cellMax) * 47)}%, var(--color-paper))` : "var(--color-tint)" }}
                            title={`${RECOMMENDATION_LABEL[r]} → ${o.label}: ${n}`}
                          >
                            {n || <span className="text-ink-2">0</span>}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[12px] text-ink-2">Outlined cells are the decisions that follow the recommendation.</p>
        </Panel>
      </div>

      <Panel
        title="Reviewers"
        about={`Open cases each person holds now, and their decisions in the last ${days} days. Overruled: approved what was not recommended, or denied what was.`}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-rule text-[13px] text-ink-2">
              <tr>
                {["Reviewer", "Open now", "Decisions", "Overruled", "Denials"].map((h, i) => (
                  <th key={h} scope="col" className={`py-2 font-semibold ${i ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {busy.map((r) => (
                <tr key={r.user_id} className="border-b border-rule last:border-0">
                  <td className="py-2">
                    <span className="font-semibold">{r.name}</span> <span className="text-ink-2 capitalize">{r.role}</span>
                  </td>
                  <td className="py-2 text-right">{r.open_cases}</td>
                  <td className="py-2 text-right">{r.decisions}</td>
                  <td className="py-2 text-right">{r.against ? `${r.against} (${percent(r.against, r.decisions)})` : "0"}</td>
                  <td className="py-2 text-right">{r.role === "physician" ? r.denied : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {busy.length === 0 && <p className="mt-3 text-sm text-ink-2">Nobody holds or decided a case in this period.</p>}
        {idle > 0 && busy.length > 0 && (
          <p className="mt-3 text-[13px] text-ink-2">
            {idle} more {idle === 1 ? "reviewer has" : "reviewers have"} no open cases and no decisions in this period.
          </p>
        )}
      </Panel>

      <Panel title="Automated review" about={`Reviews run in the last ${days} days.`}>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-5">
          {[
            ["Finished", b.engine.done],
            ["Waiting or running", b.engine.waiting],
            ["Failed", b.engine.failed],
            ["Flagged for a person", `${b.engine.flagged} (${percent(b.engine.flagged, b.engine.done)})`],
            ["Median time", b.engine.median_ms === null ? "–" : `${(b.engine.median_ms / 1000).toFixed(1)} s`],
          ].map(([k, v]) => (
            <div key={String(k)}>
              <dt className="text-[13px] text-ink-2">{k}</dt>
              <dd className={`text-[18px] font-semibold ${k === "Failed" && Number(v) > 0 ? "text-unmet" : ""}`}>{v}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>
  );
}
