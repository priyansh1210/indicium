import type { Metadata } from "next";

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
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <p className="font-serif text-xl font-semibold">Indicium</p>
        <div className="sheet mt-4 p-6 sm:p-8">
          <h1 className="title">Sign in to review</h1>
          <p className="mt-2 text-ink-2">
            Prior-authorization requests, checked against coverage policy, with the evidence for
            every item.
          </p>
          <div className="mt-6">
            <SignInForm next={next ?? "/"} demoUsers={users} />
          </div>
        </div>
      </div>
    </main>
  );
}
