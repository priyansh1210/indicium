import type { Metadata } from "next";

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
      <SignInForm next={next ?? "/"} notice={NOTICES[notice ?? ""] ?? null} demoUsers={users} />
    </PublicShell>
  );
}
