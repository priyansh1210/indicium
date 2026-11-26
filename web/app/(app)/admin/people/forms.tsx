"use client";

import { useActionState } from "react";

import { ConfirmSubmit, CopyValue } from "@/components/controls";
import { FormMessage } from "@/components/public-shell";
import { ROLE_DUTY } from "@/lib/format";
import type { Role } from "@/lib/types";

import { changeRole, invite, sendLink, setActive, type LinkResult } from "../actions";
import type { Person } from "./page";

const ROLES: Role[] = ["nurse", "physician", "supervisor", "viewer", "admin"];

export function InviteForm() {
  const [state, action, pending] = useActionState<LinkResult, FormData>(invite, { error: null });
  return (
    <div className="mt-5 space-y-4">
      <form action={action} key={state.link ?? "invite"} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_auto] md:items-end">
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold">Full name</span>
          <input name="name" required maxLength={200} autoComplete="off" className="field" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold">Work email</span>
          <input name="email" type="email" required maxLength={320} autoComplete="off" className="field" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold">Role</span>
          <select name="role" required defaultValue="nurse" className="field h-[43px] capitalize">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending} className="btn btn-primary justify-center">
          {pending ? "Inviting…" : "Send invitation"}
        </button>
      </form>
      <FormMessage error={state.error} notice={state.notice} />
      {state.link && (
        <div className="space-y-1.5">
          <p className="text-[13px] text-ink-2">If the email is slow, share this link with them directly. It works once.</p>
          <CopyValue value={state.link} label="Invitation link" />
        </div>
      )}
    </div>
  );
}

export function RoleSelect({ userId, role, name }: { userId: number; role: Role; name: string }) {
  const [state, action, pending] = useActionState(changeRole.bind(null, userId), { error: null });
  return (
    <form action={action} className="space-y-1">
      <select
        name="role"
        defaultValue={role}
        disabled={pending}
        aria-label={`Role of ${name}`}
        title={ROLE_DUTY[role]}
        onChange={(e) => e.currentTarget.form!.requestSubmit()}
        className="field w-auto py-1.5 capitalize"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      {state.error && <p role="alert" className="text-[13px] text-unmet">{state.error}</p>}
    </form>
  );
}

export function PersonActions({ person }: { person: Person }) {
  const [linkState, link, linking] = useActionState<LinkResult>(() => sendLink(person.user_id), { error: null });
  const [activeState, toggle, toggling] = useActionState(() => setActive(person.user_id, !person.active), { error: null });
  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap gap-2">
        {person.active && (
          <form action={link}>
            <button type="submit" disabled={linking} className="btn h-8 px-2.5 text-[13px]">
              {linking ? "Sending…" : person.state === "invited" ? "Resend invitation" : "Send reset link"}
            </button>
          </form>
        )}
        <form action={toggle}>
          {person.active ? (
            <ConfirmSubmit confirm="Confirm deactivate" pending={toggling} className="btn h-8 px-2.5 text-[13px]">
              Deactivate
            </ConfirmSubmit>
          ) : (
            <button type="submit" disabled={toggling} className="btn h-8 px-2.5 text-[13px]">
              Reactivate
            </button>
          )}
        </form>
      </div>
      <FormMessage error={linkState.error ?? activeState.error} notice={linkState.notice} />
      {linkState.link && <CopyValue value={linkState.link} label={`Link for ${person.name}`} />}
    </div>
  );
}
