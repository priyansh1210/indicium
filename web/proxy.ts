import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "./lib/session";

// An optimistic check only: without a session cookie, the front door shows what Indicium is and
// any other page asks to sign in. Whether the session is still valid is decided by the API on
// every call (lib/api.ts sends an expired one to sign-in too).
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return;
  const wanted = request.nextUrl.pathname + request.nextUrl.search;
  if (wanted === "/") return NextResponse.redirect(new URL("/welcome", request.url));
  const login = new URL("/login", request.url);
  login.searchParams.set("next", wanted);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!login|welcome|register|forgot-password|set-password|verify-email|_next/|favicon.ico|icon.svg).*)"],
};
