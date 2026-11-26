import Link from "next/link";

import { Icon } from "@/components/icons";
import { NavLink } from "@/components/nav-link";
import { Wordmark } from "@/components/wordmark";
import { api } from "@/lib/api";
import type { Principal } from "@/lib/types";

import { signOut } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await api<Principal>("/auth/me");
  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule bg-paper">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-4 px-4 sm:gap-8 sm:px-6">
          <Wordmark />
          <nav aria-label="Main" className="flex items-center gap-1 sm:gap-4">
            <NavLink href="/" icon="worklist">
              Worklist
            </NavLink>
            <NavLink href="/policies" icon="document">
              Policies
            </NavLink>
            {me.role === "admin" && (
              <NavLink href="/admin" icon="users">
                Admin
              </NavLink>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-4">
            <Link href="/account" className="flex items-center gap-2 rounded-md px-2 py-1 text-right text-[13px] leading-tight hover:bg-tint">
              <span className="hidden sm:block">
                <span className="block font-semibold">{me.name}</span>
                <span className="text-ink-2 capitalize">{me.role}</span>
              </span>
              <Icon name="user" className="size-5 sm:hidden" />
              <span className="sr-only sm:hidden">Your account</span>
            </Link>
            <form action={signOut}>
              <button type="submit" className="btn h-9 px-3" aria-label="Sign out">
                <Icon name="signout" />
                <span className="hidden md:inline">Sign out</span>
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
