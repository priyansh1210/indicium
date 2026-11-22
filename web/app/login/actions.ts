"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { API_URL, detailText } from "@/lib/api";
import { SESSION_COOKIE } from "@/lib/session";

export type SignInState = { error: string | null };

/** Only same-site paths: "/cases/3" yes, "//evil.example" or "https://..." no. */
function safeNext(next: FormDataEntryValue | null): string {
  const path = typeof next === "string" ? next : "";
  return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") ? path : "/";
}

export async function signIn(_: SignInState, form: FormData): Promise<SignInState> {
  const forwarded = (await headers()).get("x-forwarded-for");
  let response: Response;
  try {
    response = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        // The API limits failed sign-ins per address; pass on the visitor's, as the proxy saw it.
        ...(forwarded ? { "X-Forwarded-For": forwarded } : {}),
      },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    });
  } catch {
    return { error: "The Indicium service cannot be reached. Try again in a moment." };
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    return { error: detailText(body.detail) };
  }
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  const token = cookie?.split(";")[0].split("=")[1];
  const maxAge = Number(/max-age=(\d+)/i.exec(cookie ?? "")?.[1] ?? 43_200);
  if (!token) return { error: "Sign-in did not return a session. Try again." };
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge,
  });
  redirect(safeNext(form.get("next")));
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await fetch(`${API_URL}/auth/logout`, {
      method: "POST",
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    }).catch(() => undefined); // signing out locally still works if the API is down
  }
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
