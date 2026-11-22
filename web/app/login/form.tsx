"use client";

import { useActionState, useRef } from "react";

import { signIn, type SignInState } from "./actions";

type DemoUser = { email: string; name: string; role: string; password: string };

export function SignInForm({ next, demoUsers }: { next: string; demoUsers: DemoUser[] }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, { error: null });
  const form = useRef<HTMLFormElement>(null);

  function signInAs(user: DemoUser) {
    const fields = form.current!.elements as unknown as Record<string, HTMLInputElement>;
    fields.email.value = user.email;
    fields.password.value = user.password;
    form.current!.requestSubmit();
  }

  return (
    <>
      <form ref={form} action={action} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold">Email</span>
          <input name="email" type="email" autoComplete="username" required className="field" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold">Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="field"
          />
        </label>
        {state.error && (
          <p role="alert" className="rounded-lg bg-unmet-soft px-3 py-2 text-sm text-unmet">
            {state.error}
          </p>
        )}
        <button type="submit" disabled={pending} className="btn btn-primary w-full justify-center">
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {demoUsers.length > 0 && (
        <section className="mt-8 border-t border-rule pt-6" aria-labelledby="demo-heading">
          <h2 id="demo-heading" className="heading">
            Demo sign-ins
          </h2>
          <p className="mt-1 text-[13px] text-ink-2">
            Synthetic data only. Each role sees and may do different things. Password:{" "}
            <span className="code">{demoUsers[0].password}</span>
          </p>
          <ul className="mt-3 grid gap-2">
            {demoUsers.map((user) => (
              <li key={user.email}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => signInAs(user)}
                  className="btn w-full justify-between"
                >
                  <span>{user.name}</span>
                  <span className="text-[13px] font-normal text-ink-2 capitalize">{user.role}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
