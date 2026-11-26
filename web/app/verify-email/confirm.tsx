"use client";

import { useActionState } from "react";

import { FormMessage } from "@/components/public-shell";
import { confirmEmail, type LinkState } from "@/lib/account-actions";

export function ConfirmButton({ token }: { token: string }) {
  const [state, action, pending] = useActionState<LinkState, FormData>(() => confirmEmail(token), { error: null });
  return (
    <form action={action} className="max-w-md space-y-4">
      <FormMessage error={state.error} />
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Confirming…" : "Confirm my email address"}
      </button>
    </form>
  );
}
