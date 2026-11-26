import type { Metadata } from "next";
import Link from "next/link";

import { PublicShell } from "@/components/public-shell";
import { inspectLink } from "@/lib/account-actions";

import { PasswordForm } from "./form";

export const metadata: Metadata = { title: "Choose a password" };

export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const link = await inspectLink(token);
  if (!link || link.purpose === "verify") {
    return (
      <PublicShell title="This link no longer works" lead="Links from Indicium emails work once and expire. Ask for a new one.">
        <div className="flex flex-wrap gap-3">
          <Link href="/forgot-password" className="btn btn-primary">
            Send me a new link
          </Link>
          <Link href="/login" className="btn">
            Sign in
          </Link>
        </div>
      </PublicShell>
    );
  }
  const invite = link.purpose === "invite";
  return (
    <PublicShell
      title={invite ? `Welcome, ${link.name.split(" ")[0]}` : "Choose a new password"}
      lead={
        invite ? (
          <>
            You have a <strong className="font-semibold text-ink">{link.role}</strong> account on Indicium. Choose a
            password to finish setting it up.
          </>
        ) : (
          "Your old password stops working, and every device signed in to this account is signed out."
        )
      }
    >
      <PasswordForm token={token!} email={link.email} />
    </PublicShell>
  );
}
