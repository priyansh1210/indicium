import type { Metadata } from "next";
import Link from "next/link";

import { PublicShell } from "@/components/public-shell";
import { inspectLink } from "@/lib/account-actions";

import { ConfirmButton } from "./confirm";

export const metadata: Metadata = { title: "Confirm your email" };

// The page asks for a press instead of confirming on load: mail scanners open links, and a
// confirmation should come from the person.
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const link = await inspectLink(token);
  if (!link || link.purpose !== "verify") {
    return (
      <PublicShell title="This link no longer works" lead="It may have been used already. Try signing in; if your address still needs confirming, we say so there.">
        <Link href="/login" className="btn btn-primary">
          Sign in
        </Link>
      </PublicShell>
    );
  }
  return (
    <PublicShell title="Confirm your email" lead={`Confirm that ${link.email} belongs to ${link.name}, and the account is ready.`}>
      <ConfirmButton token={token!} />
    </PublicShell>
  );
}
