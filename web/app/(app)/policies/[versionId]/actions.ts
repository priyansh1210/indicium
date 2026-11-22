"use server";

import { refresh } from "next/cache";

import { ApiError, api } from "@/lib/api";

export async function publishVersion(versionId: number): Promise<{ error: string | null }> {
  try {
    await api(`/policies/versions/${versionId}/publish`, { method: "POST" });
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
  refresh();
  return { error: null };
}
