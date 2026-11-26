"use server";

import { api } from "@/lib/api";
import { attempt as run } from "@/lib/attempt";

export type FormState = { error: string | null; done?: boolean };

async function attempt(call: () => Promise<unknown>): Promise<FormState> {
  const { error } = await run(call, "");
  return { error, done: error === null };
}

export async function correctItem(
  caseId: number,
  runId: number,
  criterionId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  return attempt(() =>
    api(`/cases/${caseId}/checklist/${encodeURIComponent(criterionId)}`, {
      method: "POST",
      body: JSON.stringify({ run_id: runId, finding: form.get("finding"), reason: form.get("reason") }),
    }),
  );
}

export async function decide(
  caseId: number,
  runId: number,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  return attempt(() =>
    api(`/cases/${caseId}/decision`, {
      method: "POST",
      body: JSON.stringify({ run_id: runId, outcome: form.get("outcome"), reason: form.get("reason") }),
    }),
  );
}

export async function reviewAgain(caseId: number): Promise<FormState> {
  return attempt(() => api(`/cases/${caseId}/review`, { method: "POST" }));
}
