"use client";

import { useActionState } from "react";

import { FormMessage } from "@/components/public-shell";
import type { ActionState } from "@/lib/attempt";
import { keepForm } from "@/lib/keep-form";

import { addDocuments } from "../../actions";
import { DocumentFields } from "../../documents";

export function MoreDocuments({ caseId }: { caseId: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addDocuments.bind(null, caseId), { error: null });
  return (
    <form onSubmit={keepForm(action)} className="space-y-4" aria-label="Send more documents">
      <DocumentFields first="therapy_note" />
      <FormMessage error={state.error} notice={state.notice} />
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Sending…" : "Send documents"}
      </button>
    </form>
  );
}
