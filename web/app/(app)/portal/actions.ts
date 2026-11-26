"use server";

import { redirect } from "next/navigation";

import { ApiError, api } from "@/lib/api";
import { attempt, type ActionState } from "@/lib/attempt";

type Document = { doc_id: string; kind: string; author: string; written_on: string | null; text: string };

/** The documents typed or loaded into the form, numbered so ids never repeat on a case. */
function documents(form: FormData, prefix: string): Document[] {
  const texts = form.getAll("doc_text").map(String);
  return texts
    .map((text, i) => ({
      doc_id: `${prefix}-${i + 1}`,
      kind: String(form.getAll("doc_kind")[i] ?? "other"),
      author: String(form.getAll("doc_author")[i] ?? "").trim(),
      written_on: String(form.getAll("doc_date")[i] ?? "") || null,
      text: text.trim(),
    }))
    .filter((d) => d.text);
}

const codes = (value: FormDataEntryValue | null) =>
  String(value ?? "")
    .split(/[\s,;]+/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);

export async function submitRequest(externalId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const body = {
    // Made when the form opened: sending the same form twice returns the first request.
    external_id: externalId,
    patient: {
      member_id: String(form.get("member_id") ?? "").trim(),
      name: String(form.get("patient_name") ?? "").trim(),
      birth_date: form.get("birth_date"),
      sex: form.get("sex"),
    },
    procedure_code: String(form.get("procedure_code") ?? "").trim().toUpperCase(),
    diagnosis_codes: codes(form.get("diagnosis_codes")),
    urgency: form.get("urgency"),
    requested_by: String(form.get("requested_by") ?? "").trim(),
    documents: documents(form, "doc"),
  };
  let caseId: number;
  try {
    caseId = (await api<{ case_id: number }>("/cases", { method: "POST", body: JSON.stringify(body) })).case_id;
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
  redirect(`/portal/requests/${caseId}?sent=1`);
}

export async function addDocuments(caseId: number, _: ActionState, form: FormData): Promise<ActionState> {
  const added = documents(form, `added-${Date.now().toString(36)}`);
  if (added.length === 0) return { error: "Add the text of at least one document." };
  const { error } = await attempt(
    () => api(`/cases/${caseId}/documents`, { method: "POST", body: JSON.stringify({ documents: added }) }),
    "",
  );
  if (error) return { error };
  // The form goes away once the request is back in review, so the page itself confirms it.
  redirect(`/portal/requests/${caseId}?sent=documents`);
}

export async function inviteColleague(_: ActionState, form: FormData): Promise<ActionState> {
  const email = String(form.get("email") ?? "").trim();
  return attempt(
    () => api("/portal/team", { method: "POST", body: JSON.stringify({ name: form.get("name"), email }) }),
    `Invitation sent to ${email}.`,
  );
}
