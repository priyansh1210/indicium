import type { Metadata } from "next";
import Link from "next/link";

import { PublicShell } from "@/components/public-shell";
import { API_URL } from "@/lib/api";

import { SignInForm } from "./form";

export const metadata: Metadata = { title: "Sign in" };

// Fixed messages by key: the page never repeats text it was handed in the address.
const NOTICES: Record<string, string> = {
  "password-set": "Your password is set. Sign in with it.",
  verified: "Your email address is confirmed. You can sign in.",
  "signed-out": "You are signed out.",
};

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
  searchParams: Promise<{ next?: string; notice?: string }>;
}) {
  const [{ next, notice }, users] = await Promise.all([searchParams, demoUsers()]);
  return (
    <PublicShell
      title="Sign in"
      lead="Prior-authorization requests, checked against coverage policy, with the sentence in the notes behind every item."
    >
      <div className="grid gap-12 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] lg:gap-24">
        <SignInForm next={next ?? "/"} notice={NOTICES[notice ?? ""] ?? null} demoUsers={users} />
        {/* Two kinds of people arrive here; each needs a different way in. */}
        <aside aria-label="New to Indicium" className="max-w-md divide-y divide-rule border-y border-rule lg:self-start">
          <section className="py-6">
            <h2 className="font-serif text-[22px] font-semibold">Reviewing for a health plan?</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
              Your organization&rsquo;s administrator invites you. The invitation arrives by email with a link to
              choose your password.
            </p>
          </section>
          <section className="py-6">
            <h2 className="font-serif text-[22px] font-semibold">Requesting for a practice?</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
              Send requests with the clinical notes, follow each one, and answer when the reviewer asks for more.
            </p>
            <Link href="/register" className="btn mt-4">
              Register your practice
            </Link>
          </section>
        </aside>
      </div>
    </PublicShell>
  );
}
