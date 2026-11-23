"use client";

import { useActionState, useRef, useState } from "react";

import { ROLE_DUTY } from "@/lib/format";
import type { Role } from "@/lib/types";

import { signIn, type SignInState } from "./actions";

type DemoUser = { email: string; name: string; role: Role; password: string };

export function SignInForm({ next, demoUsers }: { next: string; demoUsers: DemoUser[] }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, { error: null });
  const [chosen, setChosen] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);

  function signInAs(user: DemoUser) {
    const fields = form.current!.elements as unknown as Record<string, HTMLInputElement>;
    fields.email.value = user.email;
    fields.password.value = user.password;
    setChosen(user.email);
    form.current!.requestSubmit();
  }

  const emailForm = (
    <form ref={form} action={action} className="space-y-4" aria-labelledby="email-heading">
      <h2 id="email-heading" className="heading">
        {demoUsers.length ? "Or with an email" : "With an email"}
      </h2>
      <input type="hidden" name="next" value={next} />
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold">Email</span>
        <input name="email" type="email" autoComplete="username" required className="field" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold">Password</span>
        <input name="password" type="password" autoComplete="current-password" required className="field" />
      </label>
      {state.error && (
        <p role="alert" className="rounded-lg bg-unmet-soft px-3 py-2 text-sm text-unmet">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} onClick={() => setChosen(null)} className="btn btn-primary w-full justify-center">
        {pending && !chosen ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );

  if (demoUsers.length === 0) return <div className="max-w-md">{emailForm}</div>;

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)] lg:gap-16">
      <section aria-labelledby="demo-heading">
        <h2 id="demo-heading" className="heading">
          Choose a role
        </h2>
        <p className="mt-1 text-[13px] text-ink-2">
          Synthetic data only. Each role sees and may do different things. Password for all:{" "}
          <span className="code text-ink">{demoUsers[0].password}</span>
        </p>
        <ul className="mt-5 border-t border-rule">
          {demoUsers.map((user, i) => (
            <li key={user.email} className="rise border-b border-rule" style={{ "--i": i + 2 } as React.CSSProperties}>
              <button
                type="button"
                disabled={pending}
                onClick={() => signInAs(user)}
                className="group flex w-full items-center gap-4 py-4 text-left transition-colors duration-200 hover:bg-paper disabled:cursor-wait sm:px-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-3">
                    <span className="stroke stroke-under font-serif text-[22px] font-semibold group-hover:[background-size:100%_38%]" data-on={chosen === user.email && pending}>
                      {user.name}
                    </span>
                    <span className="text-sm font-semibold text-ink-2 capitalize">{user.role}</span>
                  </span>
                  <span className="mt-1 block text-[14px] text-ink-2">{ROLE_DUTY[user.role]}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-ink-2 transition-transform duration-200 group-hover:translate-x-1 group-hover:text-ink">
                  {chosen === user.email && pending ? "Signing in…" : "Sign in →"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <div className="lg:pt-0">{emailForm}</div>
    </div>
  );
}
