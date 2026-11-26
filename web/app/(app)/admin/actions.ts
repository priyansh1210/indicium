"use server";

import { api } from "@/lib/api";
import { attempt, type ActionState } from "@/lib/attempt";

export type LinkResult = ActionState & { link?: string };
export type KeyResult = ActionState & { key?: string };

const post = <T,>(path: string, body?: unknown, method = "POST") =>
  api<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export async function invite(_: LinkResult, form: FormData): Promise<LinkResult> {
  const email = String(form.get("email") ?? "");
  const { result, ...state } = await attempt(
    () => post<{ link: string }>("/users", { email, name: form.get("name"), role: form.get("role") }),
    `Invitation sent to ${email}.`,
  );
  return { ...state, link: result?.link };
}

export async function changeRole(userId: number, _: ActionState, form: FormData): Promise<ActionState> {
  return attempt(() => post(`/users/${userId}`, { role: form.get("role") }, "PATCH"), "Role changed. They sign in again.");
}

export async function setActive(userId: number, active: boolean): Promise<ActionState> {
  return attempt(
    () => post(`/users/${userId}`, { active }, "PATCH"),
    active ? "Reactivated." : "Deactivated and signed out.",
  );
}

export async function sendLink(userId: number): Promise<LinkResult> {
  const { result, ...state } = await attempt(
    () => post<{ kind: "invite" | "reset"; link: string }>(`/users/${userId}/link`),
    (r) => (r.kind === "invite" ? "A new invitation is on its way." : "A password reset link is on its way."),
  );
  return { ...state, link: result?.link };
}

export async function createKey(_: KeyResult, form: FormData): Promise<KeyResult> {
  const { result, ...state } = await attempt(
    () => post<{ key: string }>("/api-keys", { name: form.get("name") }),
    "Key created. Copy it now: it is not shown again.",
  );
  return { ...state, key: result?.key };
}

export async function revokeKey(keyId: number): Promise<ActionState> {
  return attempt(() => post(`/api-keys/${keyId}/revoke`), "Revoked. Requests with this key are refused from now on.");
}
