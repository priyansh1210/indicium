"use server";

import { api } from "@/lib/api";
import { attempt, type ActionState } from "@/lib/attempt";

export type AccountState = ActionState;
export type MfaSetup = ActionState & { secret?: string; qr_svg?: string };

const send = (path: string, body?: unknown, method = "POST") =>
  api(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export async function rename(_: AccountState, form: FormData): Promise<AccountState> {
  return attempt(() => send("/auth/account", { name: form.get("name") }, "PATCH"), "Name saved.");
}

export async function changePassword(_: AccountState, form: FormData): Promise<AccountState> {
  if (form.get("new_password") !== form.get("confirm")) return { error: "The two new passwords are not the same." };
  return attempt(
    () => send("/auth/password", { current_password: form.get("current_password"), new_password: form.get("new_password") }),
    "Password changed. Other devices are signed out.",
  );
}

export async function revokeOthers(): Promise<AccountState> {
  return attempt(() => send("/auth/sessions/revoke-others"), "Every other device is signed out.");
}

export async function startMfa(): Promise<MfaSetup> {
  const { result, ...state } = await attempt(
    () => api<{ secret: string; qr_svg: string }>("/auth/mfa/setup", { method: "POST" }),
    "",
  );
  return { ...state, notice: null, ...result };
}

export async function enableMfa(_: AccountState, form: FormData): Promise<AccountState> {
  return attempt(() => send("/auth/mfa/enable", { code: form.get("code") }), "Two-step sign-in is on.");
}

export async function disableMfa(_: AccountState, form: FormData): Promise<AccountState> {
  return attempt(() => send("/auth/mfa/disable", { password: form.get("password") }), "Two-step sign-in is off.");
}
