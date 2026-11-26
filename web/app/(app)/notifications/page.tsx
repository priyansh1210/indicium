import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Icon, type IconName } from "@/components/icons";
import { api } from "@/lib/api";
import { deadline, moment, PORTAL_STATUS, STATUS_LABEL } from "@/lib/format";
import { NOTIFIED, type Notice, type NotificationKind, type Principal } from "@/lib/types";

import { openNotice, readAll } from "./actions";

export const metadata: Metadata = { title: "Notifications" };

const KIND: Record<NotificationKind, { icon: IconName; say: (n: Notice) => string }> = {
  assigned: {
    icon: "user",
    say: (n) => `${n.patient}'s request was given to you`,
  },
  documents: {
    icon: "document",
    say: (n) => `New documents arrived for ${n.patient}; it is being reviewed again`,
  },
  due_soon: {
    icon: "clock",
    say: (n) => `${n.patient}'s request is ${deadline(n.due_at).overdue ? "past its deadline" : "due within a day"}`,
  },
  decided: {
    icon: "inbox",
    say: (n) => `A decision was made on ${n.patient}'s request`,
  },
};

export default async function NotificationsPage() {
  const me = await api<Principal>("/auth/me");
  if (!NOTIFIED.includes(me.role)) notFound();
  const inbox = await api<{ unread: number; items: Notice[] }>("/notifications");
  const provider = me.role === "provider";
  const status = (n: Notice) => (provider ? PORTAL_STATUS[n.status].label : STATUS_LABEL[n.status]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="title">Notifications</h1>
          <p className="mt-1 text-ink-2">
            {inbox.unread ? `${inbox.unread} unread.` : "All read."} Showing the latest 50.
          </p>
        </div>
        {inbox.unread > 0 && (
          <form action={readAll}>
            <button type="submit" className="btn">
              Mark all as read
            </button>
          </form>
        )}
      </div>

      {inbox.items.length === 0 ? (
        <div className="rise sheet bg-tint px-6 py-14 text-center" style={{ "--i": 1 } as React.CSSProperties}>
          <p className="font-serif text-xl font-semibold">Nothing yet.</p>
          <p className="mx-auto mt-1 max-w-[52ch] text-ink-2">
            {provider
              ? "You hear here, and by email, when a decision is made on one of your practice's requests."
              : "You hear here when a case is given to you, when documents arrive on a case you hold, and a day before its deadline."}
          </p>
        </div>
      ) : (
        <ul className="sheet divide-y divide-rule">
          {inbox.items.map((n, i) => (
            <li key={n.notification_id} className="rise" style={{ "--i": i + 1 } as React.CSSProperties}>
              <form action={openNotice.bind(null, n.notification_id, n.case_id, provider)}>
                <button type="submit" className="flex w-full items-start gap-3 px-5 py-4 text-left hover:bg-tint">
                  <Icon
                    name={KIND[n.kind].icon}
                    className={`mt-0.5 size-5 shrink-0 ${n.read_at ? "text-ink-3" : "text-accent"}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block ${n.read_at ? "text-ink-2" : "font-semibold"}`}>{KIND[n.kind].say(n)}</span>
                    <span className="mt-0.5 block text-[13px] text-ink-2">
                      <span className="code">{n.external_id}</span> · {status(n)} · {moment(n.created_at)}
                    </span>
                  </span>
                  {!n.read_at && (
                    <span className="mt-2 size-2 shrink-0 rounded-full bg-accent">
                      <span className="sr-only">Unread</span>
                    </span>
                  )}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
