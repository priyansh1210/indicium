"use server";

// Actions of the pages reached without a session: forgot password, choose a password from an
// emailed link, confirm an email address.
import { redirect } from "next/navigation";

import { ApiError, publicApi } from "./api";

export type LinkState = { error: string | null; notice?: string | null };

function failure(error: unknown): LinkState {
  if (error instanceof ApiError) return { error: error.message };
  throw error;
}

export async function requestReset(_: LinkState, form: FormData): Promise<LinkState> {
  try {
    const { detail } = await publicApi<{ detail: string }>("/auth/forgot", { email: form.get("email") });
    return { error: null, notice: detail };
  } catch (error) {
    return failure(error);
  }
}

export async function choosePassword(token: string, _: LinkState, form: FormData): Promise<LinkState> {
  if (form.get("password") !== form.get("confirm")) return { error: "The two passwords are not the same." };
  try {
    await publicApi("/auth/password/set", { token, password: form.get("password") });
  } catch (error) {
    return failure(error);
  }
  redirect("/login?notice=password-set");
}

export async function confirmEmail(token: string): Promise<LinkState> {
  try {
    await publicApi("/auth/verify", { token });
  } catch (error) {
    return failure(error);
  }
  redirect("/login?notice=verified");
}

/** Who a link belongs to, or null when it has expired or was used. */
export async function inspectLink(token: string | undefined) {
  if (!token) return null;
  try {
    return await publicApi<{ purpose: "invite" | "reset" | "verify"; email: string; name: string; role: string }>(
      "/auth/token",
      { token },
    );
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 422)) return null;
    throw error;
  }
}
