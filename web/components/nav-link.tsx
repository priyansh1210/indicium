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
      className={`flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold ${
        current ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-tint hover:text-ink"
      }`}
    >
      <Icon name={icon} />
      {children}
    </Link>
  );
}
