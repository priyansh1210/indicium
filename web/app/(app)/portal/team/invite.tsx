"use client";

import { useActionState } from "react";

import { FormMessage } from "@/components/public-shell";
import type { ActionState } from "@/lib/attempt";

import { inviteColleague } from "../actions";

export function InviteColleague() {
  const [state, action, pending] = useActionState<ActionState, FormData>(inviteColleague, { error: null });
  return (
    <div className="mt-5 space-y-3">
      <form action={action} key={state.notice ?? "invite"} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:items-end">
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold">Full name</span>
          <input name="name" required maxLength={200} autoComplete="off" className="field" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold">Work email</span>
          <input name="email" type="email" required maxLength={320} autoComplete="off" className="field" />
        </label>
        <button type="submit" disabled={pending} className="btn btn-primary justify-center">
          {pending ? "Inviting…" : "Send invitation"}
        </button>
      </form>
      <FormMessage error={state.error} notice={state.notice} />
    </div>
  );
}
