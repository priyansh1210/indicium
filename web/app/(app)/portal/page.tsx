import type { Metadata } from "next";
import Link from "next/link";

import { Icon } from "@/components/icons";
import { api } from "@/lib/api";
import { PORTAL_STATUS, day, deadline } from "@/lib/format";
import type { PortalRequest } from "@/lib/types";

export const metadata: Metadata = { title: "Requests" };

export default async function PortalHome({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const { before } = await searchParams;
  const query = new URLSearchParams({ limit: "50", ...(before ? { before } : {}) });
  const page = await api<{ requests: PortalRequest[]; next: number | null }>(`/portal/requests?${query}`);
  const waiting = page.requests.filter((r) => r.status === "pended");

  return (
    <div className="space-y-7">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="title">Requests</h1>
          <p className="mt-2 text-ink-2">
            Newest first.
            {waiting.length > 0 && (
              <span className="ml-2 font-semibold text-missing">
                {waiting.length} {waiting.length === 1 ? "needs" : "need"} more information from you.
              </span>
            )}
          </p>
        </div>
        <Link href="/portal/new" className="btn btn-primary">
          <Icon name="plus" />
          New request
        </Link>
      </div>

      {page.requests.length === 0 ? (
        <div className="rise sheet bg-tint px-6 py-14 text-center" style={{ "--i": 1 } as React.CSSProperties}>
          <p className="font-serif text-xl font-semibold">No requests yet.</p>
          <p className="mx-auto mt-1 max-w-[52ch] text-ink-2">
            Send the first one with the order and the clinical notes that support it. A decision is due within 7 days, or
            72 hours when it is urgent.
          </p>
          <Link href="/portal/new" className="btn btn-primary mt-5">
            New request
          </Link>
        </div>
      ) : (
        <>
          {waiting.length > 0 && <RequestList title="Waiting for your answer" requests={waiting} />}
          <RequestList
            title={waiting.length > 0 ? "Everything else" : "All requests"}
            requests={page.requests.filter((r) => r.status !== "pended")}
          />
        </>
      )}
      {page.next && (
        <Link href={`/portal?before=${page.next}`} className="btn">
          Older requests
        </Link>
      )}
    </div>
  );
}

function RequestList({ title, requests }: { title: string; requests: PortalRequest[] }) {
  if (requests.length === 0) return null;
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="heading">{title}</h2>
      <ul className="sheet divide-y divide-rule">
        {requests.map((r, i) => {
          const status = PORTAL_STATUS[r.status];
          const open = !r.outcome || r.outcome === "pended";
          const due = deadline(r.due_at);
          return (
            <li key={r.case_id} className="rise relative" style={{ "--i": i + 1 } as React.CSSProperties}>
              <div className="grid gap-x-6 gap-y-1 px-4 py-4 transition-colors duration-150 hover:bg-tint sm:px-5 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1fr)] md:items-start">
                <div className="min-w-0">
                  <Link
                    href={`/portal/requests/${r.case_id}`}
                    className="font-serif text-[17px] font-semibold after:absolute after:inset-0 hover:underline focus-visible:underline"
                  >
                    {r.patient_name}
                  </Link>
                  <p className="text-[13px] text-ink-2">
                    <span className="code">{r.external_id}</span> · sent {day(r.received_at)}
                  </p>
                </div>
                <p className="min-w-0 text-sm">
                  <span className="code">{r.procedure_code}</span>{" "}
                  <span className="text-ink-2">{r.service ?? "No coverage policy for this code"}</span>
                </p>
                <div className="text-sm">
                  <p className={`font-semibold ${status.tone}`}>
                    {status.label}
                    {r.urgency === "expedited" && open && <span className="ml-2 font-normal text-accent">Expedited</span>}
                  </p>
                  {r.status === "pended" && r.decision_reason ? (
                    <p className="mt-0.5 line-clamp-2 text-ink-2">{r.decision_reason}</p>
                  ) : open ? (
                    <p className={`mt-0.5 ${due.overdue ? "text-unmet" : "text-ink-2"}`}>Decision {due.text}</p>
                  ) : (
                    <p className="mt-0.5 text-ink-2">{r.decided_at && day(r.decided_at)}</p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
