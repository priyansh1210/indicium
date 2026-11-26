import "server-only";

import { refresh } from "next/cache";

import { ApiError } from "./api";

export type ActionState = { error: string | null; notice?: string | null };

/** Run an API call for a Server Action: an API refusal becomes the form's error message, success
 *  refreshes the page's data and shows `notice`. Redirects and real failures pass through. */
export async function attempt<T>(call: () => Promise<T>, notice: string | ((result: T) => string)): Promise<ActionState & { result?: T }> {
  let result: T;
  try {
    result = await call();
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
  refresh();
  return { error: null, notice: typeof notice === "function" ? notice(result) : notice, result };
}
