import type { Metadata } from "next";
import Link from "next/link";

import { Wordmark } from "@/components/wordmark";
import { API_URL } from "@/lib/api";

import { SignInForm } from "./form";

export const metadata: Metadata = { title: "Sign in" };

async function demoUsers() {
  try {
    const response = await fetch(`${API_URL}/auth/demo-users`, { cache: "no-store" });
    return response.ok ? await response.json() : [];
  } catch {
    return []; // the form still shows; signing in reports the outage
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [{ next }, users] = await Promise.all([searchParams, demoUsers()]);
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-16 w-full max-w-[1120px] items-center justify-between px-4 sm:px-8">
        <Wordmark href="/welcome" />
        <Link href="/welcome" className="text-sm font-semibold text-ink-2 hover:text-ink">
          What is Indicium?
        </Link>
      </header>
      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 pt-8 pb-16 sm:px-8 lg:pt-16">
        <h1 className="display rise text-[clamp(40px,5.5vw,68px)]">Sign in to review</h1>
        <p className="rise mt-4 max-w-[56ch] text-[17px] leading-relaxed text-ink-2" style={{ "--i": 1 } as React.CSSProperties}>
          Prior-authorization requests, checked against coverage policy, with the sentence in the
          notes behind every item.
        </p>
        <div className="mt-10">
          <SignInForm next={next ?? "/"} demoUsers={users} />
        </div>
      </main>
    </div>
  );
}
