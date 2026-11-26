"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon } from "./icons";

/** The top bar's way to notifications, with the unread count. */
export function Bell({ unread }: { unread: number }) {
  const current = usePathname() === "/notifications";
  return (
    <Link
      href="/notifications"
      aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
      aria-current={current ? "page" : undefined}
      className={`relative flex size-9 items-center justify-center rounded-md hover:bg-tint ${current ? "bg-tint text-ink" : "text-ink-2 hover:text-ink"}`}
    >
      <Icon name="bell" className="size-5" />
      {unread > 0 && (
        <span className="absolute top-0.5 right-0.5 h-4 min-w-4 rounded-full bg-accent px-1 text-center text-[11px] leading-4 font-semibold text-paper tabular-nums">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
