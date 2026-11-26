"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { Icon } from "@/components/icons";
import { FormMessage } from "@/components/public-shell";
import { ROLE_DUTY } from "@/lib/format";
import type { Role } from "@/lib/types";

import { signIn, type SignInState } from "./actions";

type DemoUser = { email: string; name: string; role: Role; password: string };

export function SignInForm({ next, notice, demoUsers }: { next: string; notice: string | null; demoUsers: DemoUser[] }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, { error: null });
  const [chosen, setChosen] = useState<string | null>(null);
  // Controlled, so the email and password survive the form reset after the first step and go
  // again with the code.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const form = useRef<HTMLFormElement>(null);

  function signInAs(user: DemoUser) {
    flushSync(() => {
      setEmail(user.email);
      setPassword(user.password);
      setChosen(user.email);
    });
    form.current!.requestSubmit();
  }

  return (
    <div className="max-w-md space-y-10">
      <form ref={form} action={action} className="space-y-4" aria-label="Sign in">
        <input type="hidden" name="next" value={next} />
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold">Email</span>
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            readOnly={state.mfa}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field read-only:bg-tint"
          />
        </label>
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-4">
            <label htmlFor="password" className="text-sm font-semibold">
              Password
            </label>
            <Link href="/forgot-password" className="text-[13px] font-semibold text-accent hover:underline">
              Forgot your password?
            </Link>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            readOnly={state.mfa}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field read-only:bg-tint"
          />
        </div>
        {state.mfa && (
          <div className="rise space-y-1.5">
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold">Code from your authenticator app</span>
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,7}"
                maxLength={7}
                required
                autoFocus
                aria-describedby="code-help"
                className="field code tracking-[0.2em]"
              />
            </label>
            <p id="code-help" className="text-[13px] text-ink-2">
              Six digits. A new one appears every 30 seconds.
            </p>
          </div>
        )}
        <FormMessage error={state.error} notice={state.error || state.mfa ? null : notice} />
        <button type="submit" disabled={pending} onClick={() => setChosen(null)} className="btn btn-primary w-full justify-center">
          {pending && !chosen ? "Signing in…" : state.mfa ? "Verify and sign in" : "Sign in"}
        </button>
      </form>

      {demoUsers.length > 0 && (
        <details className="group border-t border-rule pt-6">
          <summary className="flex cursor-pointer list-none items-baseline justify-between gap-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            <span>Exploring Indicium? Use a sample account</span>
            <Icon name="chevron" className="size-4 shrink-0 text-ink-2 transition-transform duration-200 group-open:rotate-90" />
          </summary>
          <p className="mt-2 text-[13px] text-ink-2">
            Synthetic patients and notes only. Each role sees and may do different things. Password for all:{" "}
            <span className="code text-ink">{demoUsers[0].password}</span>
          </p>
          <ul className="mt-3 border-t border-rule">
            {demoUsers.map((user) => (
              <li key={user.email} className="border-b border-rule">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => signInAs(user)}
                  className="group/row flex w-full items-center gap-4 py-3 text-left transition-colors duration-200 hover:bg-paper disabled:cursor-wait sm:px-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="stroke stroke-under font-semibold" data-on={chosen === user.email && pending}>
                        {user.name}
                      </span>
                      <span className="text-[13px] text-ink-2 capitalize">{user.role}</span>
                    </span>
                    <span className="mt-0.5 block text-[13px] text-ink-2">{ROLE_DUTY[user.role]}</span>
                  </span>
                  <span className="shrink-0 text-[13px] font-semibold text-ink-2 group-hover/row:text-ink">
                    {chosen === user.email && pending ? "Signing in…" : "Sign in →"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
