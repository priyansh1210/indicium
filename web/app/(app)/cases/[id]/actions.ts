"use server";

import { refresh } from "next/cache";

import { ApiError, api } from "@/lib/api";

export type FormState = { error: string | null; done?: boolean };

async function attempt(call: () => Promise<unknown>): Promise<FormState> {
  try {
    await call();
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error; // a redirect (expired session) or a real failure
  }
  refresh();
  return { error: null, done: true };
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
