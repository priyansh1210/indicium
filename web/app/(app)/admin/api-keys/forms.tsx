"use client";

import { useActionState } from "react";

import { ConfirmSubmit, CopyValue } from "@/components/controls";
import { FormMessage } from "@/components/public-shell";

import { createKey, revokeKey, type KeyResult } from "../actions";

export function NewKeyForm() {
  const [state, action, pending] = useActionState<KeyResult, FormData>(createKey, { error: null });
  return (
    <div className="mt-5 space-y-4">
      <form action={action} key={state.key ?? "key"} className="flex flex-wrap items-end gap-3">
        <label className="block min-w-64 flex-1 space-y-1.5 sm:max-w-sm">
          <span className="text-sm font-semibold">System name</span>
          <input
            name="name"
            required
            minLength={3}
            maxLength={80}
            pattern="[a-z0-9][a-z0-9\-]*"
            placeholder="e.g. riverside-ehr"
            aria-describedby="key-name-rule"
            className="field code"
          />
        </label>
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? "Creating…" : "Create key"}
        </button>
        <p id="key-name-rule" className="basis-full text-[13px] text-ink-2">
          Lowercase letters, digits and dashes. It appears in the audit trail of every request the system sends.
        </p>
      </form>
      <FormMessage error={state.error} notice={state.notice} />
      {state.key && <CopyValue value={state.key} label="New API key" />}
    </div>
  );
}

export function RevokeButton({ keyId }: { keyId: number }) {
  const [state, action, pending] = useActionState(() => revokeKey(keyId), { error: null });
  return (
    <form action={action}>
      <ConfirmSubmit confirm="Confirm revoke" pending={pending} className="btn h-8 px-2.5 text-[13px]">
        Revoke
      </ConfirmSubmit>
      {state.error && <p role="alert" className="mt-1 text-[13px] text-unmet">{state.error}</p>}
    </form>
  );
}
