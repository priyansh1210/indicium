import Link from "next/link";

import { Icon } from "@/components/icons";
import { NavLink } from "@/components/nav-link";
import { api } from "@/lib/api";
import type { Principal } from "@/lib/types";

import { signOut } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await api<Principal>("/auth/me");
  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule bg-paper">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="font-serif text-lg font-semibold">
            Indicium
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1">
            <NavLink href="/" icon="worklist">
              Worklist
            </NavLink>
            <NavLink href="/policies" icon="document">
              Policies
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <p className="hidden text-right text-[13px] leading-tight sm:block">
              <span className="block font-semibold">{me.name}</span>
              <span className="text-ink-2 capitalize">{me.role}</span>
            </p>
            <form action={signOut}>
              <button type="submit" className="btn h-9 px-3" aria-label="Sign out">
                <Icon name="signout" />
                <span className="hidden md:inline">Sign out</span>
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
