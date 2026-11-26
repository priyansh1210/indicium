"use client";

import Link from "next/link";
import { useActionState } from "react";

import { FormMessage } from "@/components/public-shell";
import { registerPractice, type LinkState } from "@/lib/account-actions";
import { keepForm } from "@/lib/keep-form";

export function RegisterForm() {
  const [state, action, pending] = useActionState<LinkState, FormData>(registerPractice, { error: null });
  if (state.notice) {
    return (
      <div className="max-w-md space-y-4">
        <FormMessage notice={state.notice} />
        <p className="text-[15px] text-ink-2">
          Open the link in that email to confirm the address, then sign in. The link works once, for 48 hours.
        </p>
        <Link href="/login" className="btn">
          Go to sign in
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={keepForm(action)} className="grid max-w-3xl gap-10 md:grid-cols-2" aria-label="Register your practice">
      <fieldset className="space-y-4">
        <legend className="font-serif text-[22px] font-semibold">The practice</legend>
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold">Practice name</span>
          <input name="practice" required minLength={2} maxLength={200} autoComplete="organization" className="field" />
        </label>
        <div className="space-y-1.5">
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold">NPI</span>
            <input
              name="npi"
              required
              inputMode="numeric"
              pattern="[0-9]{10}"
              maxLength={10}
              aria-describedby="npi-help"
              className="field code tracking-[0.08em]"
            />
          </label>
          <p id="npi-help" className="text-[13px] text-ink-2">
            The practice&rsquo;s 10-digit National Provider Identifier (type 2, from NPPES). Its last digit is checked.
          </p>
        </div>
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="font-serif text-[22px] font-semibold">You</legend>
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold">Full name</span>
          <input name="name" required maxLength={200} autoComplete="name" className="field" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold">Work email</span>
          <input name="email" type="email" required maxLength={320} autoComplete="email" className="field" />
        </label>
        <div className="space-y-1.5">
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold">Password</span>
            <input aria-describedby="password-help" name="password" type="password" required minLength={12} maxLength={200} autoComplete="new-password" className="field" />
          </label>
          <p id="password-help" className="text-[13px] text-ink-2">At least 12 characters.</p>
        </div>
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold">The same password again</span>
          <input name="confirm" type="password" required minLength={12} maxLength={200} autoComplete="new-password" className="field" />
        </label>
      </fieldset>
      <div className="space-y-3 md:col-span-2">
        <FormMessage error={state.error} />
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" disabled={pending} className="btn btn-primary">
            {pending ? "Registering…" : "Register and confirm my email"}
          </button>
          <Link href="/login" className="text-sm font-semibold text-accent hover:underline">
            Already registered? Sign in
          </Link>
        </div>
        <p className="text-[13px] text-ink-2">
          Colleagues join later: once you are in, add them from Team, and each gets their own sign-in.
        </p>
      </div>
    </form>
  );
}
