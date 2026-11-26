"use client";

import { useActionState } from "react";

import { FormMessage } from "@/components/public-shell";
import { choosePassword, type LinkState } from "@/lib/account-actions";

export function PasswordForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState<LinkState, FormData>(choosePassword.bind(null, token), {
    error: null,
  });
  return (
    <form action={action} className="max-w-md space-y-4" aria-label="Choose a password">
      {/* Lets a password manager file the new password under the right account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <p className="text-sm">
        <span className="text-ink-2">Account</span> <span className="font-semibold">{email}</span>
      </p>
      <div className="space-y-1.5">
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold">New password</span>
          <input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={200} className="field" aria-describedby="password-rule" />
        </label>
        <p id="password-rule" className="text-[13px] text-ink-2">
          At least 12 characters. A phrase of a few words is easy to remember and hard to guess.
        </p>
      </div>
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold">The same password again</span>
        <input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={200} className="field" />
      </label>
      <FormMessage error={state.error} />
      <button type="submit" disabled={pending} className="btn btn-primary w-full justify-center">
        {pending ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
