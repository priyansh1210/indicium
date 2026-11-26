"use server";

import { api } from "@/lib/api";
import { attempt, type ActionState } from "@/lib/attempt";

export async function publishVersion(versionId: number): Promise<ActionState> {
  return attempt(() => api(`/policies/versions/${versionId}/publish`, { method: "POST" }), "Published.");
}
