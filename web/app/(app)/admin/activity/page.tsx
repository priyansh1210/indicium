import type { Metadata } from "next";
import Link from "next/link";

import { api } from "@/lib/api";
import { humanize, moment } from "@/lib/format";
import type { AuditEvent } from "@/lib/types";

export const metadata: Metadata = { title: "Activity" };

const FILTERS = [
  { key: "", label: "Everything" },
  { key: "auth.", label: "Sign-ins" },
  { key: "user.", label: "Accounts" },
  { key: "api_key.", label: "API keys" },
  { key: "policy.", label: "Policies" },
  { key: "case.", label: "Cases" },
  { key: "review.", label: "Reviews" },
  { key: "checklist.", label: "Corrections" },
];

type Event = AuditEvent & { target_label: string | null };

function target(e: Event) {
  if (e.target_type === "case")
    return (
      <Link href={`/cases/${e.target_id}`} className="font-semibold text-accent hover:underline">
        case {e.target_id}
      </Link>
    );
  return <span className="text-ink-2">{e.target_label ?? `${humanize(e.target_type)} ${e.target_id}`}</span>;
}

/** An event's detail as "key value" pairs a person can read, not JSON. */
function details(detail: Record<string, unknown>): string {
  return Object.entries(detail)
    .map(([key, value]) => {
      const text = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
      return `${humanize(key)} ${text.length > 60 ? `${text.slice(0, 59)}…` : text}`;
    })
    .join(" · ");
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ action?: string; before?: string }> }) {
  const { action = "", before } = await searchParams;
  const query = new URLSearchParams({ limit: "100" });
  if (action) query.set("action", action);
  if (before) query.set("before", before);
  const page = await api<{ events: Event[]; next: number | null }>(`/audit?${query}`);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-x-4 gap-y-2" role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key ? `/admin/activity?action=${f.key}` : "/admin/activity"}
            aria-current={f.key === action ? "true" : undefined}
            className={`group text-sm font-semibold ${f.key === action ? "text-ink" : "text-ink-2 hover:text-ink"}`}
          >
            <span
              className={`stroke stroke-under ${f.key === action ? "" : "[--stroke:var(--color-rule)] group-hover:[background-size:100%_38%]"}`}
              data-on={f.key === action}
            >
              {f.label}
            </span>
          </Link>
        ))}
      </div>
      <p className="text-[13px] text-ink-2">
        Append-only: every entry was written in the same transaction as the change it records, and none can be edited.
      </p>
      {page.events.length === 0 ? (
        <p className="sheet bg-tint px-6 py-10 text-center text-ink-2">Nothing recorded of this kind yet.</p>
      ) : (
        <ol className="sheet divide-y divide-rule">
          {page.events.map((e) => (
            <li key={e.event_id} className="grid gap-x-6 gap-y-1 px-4 py-3 text-sm md:grid-cols-[150px_minmax(0,1fr)_minmax(0,1.4fr)]">
              <time dateTime={e.at} className="text-ink-2 tabular-nums">
                {moment(e.at)}
              </time>
              <span className="min-w-0">
                <span className="font-semibold">{humanize(e.action.replace(".", " "))}</span> · {target(e)}
              </span>
              <span className="min-w-0 text-ink-2">
                <span className="block truncate">by {e.actor}</span>
                {Object.keys(e.detail).length > 0 && <span className="block truncate text-[13px]">{details(e.detail)}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {page.next && (
        <Link href={`/admin/activity?${new URLSearchParams({ ...(action ? { action } : {}), before: String(page.next) })}`} className="btn">
          Older entries
        </Link>
      )}
    </div>
  );
}
