"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon, type IconName } from "./icons";

export function NavLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: IconName;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const current = href === "/" ? path === "/" || path.startsWith("/cases") : path.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`group flex h-9 items-center gap-2 px-2 text-sm font-semibold ${current ? "text-ink" : "text-ink-2 hover:text-ink"}`}
    >
      <Icon name={icon} />
      {/* Hover previews the stroke in grey; only the current page wears the marker. */}
      {/* Below 640px the icons carry the bar; the words stay for screen readers. */}
      <span
        className={`stroke stroke-under max-sm:sr-only ${current ? "" : "[--stroke:var(--color-rule)] group-hover:[background-size:100%_38%]"}`}
        data-on={current}
      >
        {children}
      </span>
    </Link>
  );
}
