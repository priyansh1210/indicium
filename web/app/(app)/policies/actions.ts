"use server";

import { api } from "@/lib/api";
import { attempt, type ActionState } from "@/lib/attempt";

export type UploadState = ActionState & { versionId?: number };

export async function uploadPolicy(_: UploadState, form: FormData): Promise<UploadState> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a policy file." };
  // Server Actions accept bodies up to 1 MB (Next.js default); policy files are tens of kB.
  if (file.size > 900_000) return { error: "A policy file is at most 900 kB." };
  const yaml = await file.text();
  const { result, ...state } = await attempt(
    () => api<{ version_id: number; created: boolean }>("/policies/yaml", { method: "POST", body: JSON.stringify({ yaml }) }),
    (r) => (r.created ? "Added as a draft. Nothing uses it until it is published." : "This exact version is already stored."),
  );
  return { ...state, versionId: result?.version_id };
}
