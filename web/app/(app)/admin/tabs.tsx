"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/people", label: "People" },
  { href: "/admin/api-keys", label: "API keys" },
  { href: "/admin/activity", label: "Activity" },
];

export function AdminTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Administration" className="rise -mx-4 flex gap-1 overflow-x-auto border-b border-rule px-4 sm:mx-0 sm:px-0" style={{ "--i": 1 } as React.CSSProperties}>
      {TABS.map((tab) => {
        const current = path.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className={`-mb-px flex h-11 shrink-0 items-center border-b-2 px-3 text-sm font-semibold ${
              current ? "border-ink text-ink" : "border-transparent text-ink-2 hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
