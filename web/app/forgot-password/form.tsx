"use client";

import Link from "next/link";
import { useActionState } from "react";

import { FormMessage } from "@/components/public-shell";
import { requestReset, type LinkState } from "@/lib/account-actions";

export function ForgotForm() {
  const [state, action, pending] = useActionState<LinkState, FormData>(requestReset, { error: null });
  return (
    <form action={action} className="max-w-md space-y-4" aria-label="Reset your password">
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold">Email</span>
        <input name="email" type="email" autoComplete="username" required className="field" />
      </label>
      <FormMessage error={state.error} notice={state.notice} />
      <button type="submit" disabled={pending} className="btn btn-primary w-full justify-center">
        {pending ? "Sending…" : state.notice ? "Send again" : "Send the link"}
      </button>
      <p className="text-sm">
        <Link href="/login" className="font-semibold text-accent hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
