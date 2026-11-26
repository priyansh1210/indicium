"use client";

import { useActionState } from "react";

import { FormMessage } from "@/components/public-shell";

import {
  changePassword,
  disableMfa,
  enableMfa,
  rename,
  revokeOthers,
  startMfa,
  type AccountState,
  type MfaSetup,
} from "./actions";

const initial: AccountState = { error: null };

export function NameForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState(rename, initial);
  return (
    <form action={action} className="space-y-3">
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold">Full name</span>
        <input name="name" defaultValue={name} required maxLength={200} autoComplete="name" className="field" />
      </label>
      <FormMessage {...state} />
      <button type="submit" disabled={pending} className="btn">
        {pending ? "Saving…" : "Save name"}
      </button>
    </form>
  );
}

export function PasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(changePassword, initial);
  return (
    <form action={action} className="space-y-3" key={state.notice ?? "form"}>
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold">Current password</span>
        <input name="current_password" type="password" autoComplete="current-password" required className="field" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold">New password</span>
        <input name="new_password" type="password" autoComplete="new-password" required minLength={12} maxLength={200} className="field" />
        <span className="block text-[13px] text-ink-2">At least 12 characters.</span>
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold">New password again</span>
        <input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={200} className="field" />
      </label>
      <FormMessage {...state} />
      <button type="submit" disabled={pending} className="btn">
        {pending ? "Changing…" : "Change password"}
      </button>
    </form>
  );
}

export function MfaSection({ enabled }: { enabled: boolean }) {
  const [setup, begin, starting] = useActionState<MfaSetup>(startMfa, initial);
  const [enableState, enable, enabling] = useActionState(enableMfa, initial);
  const [disableState, disable, disabling] = useActionState(disableMfa, initial);

  if (enabled) {
    return (
      <form action={disable} className="space-y-3">
        <p className="flex items-center gap-2 font-semibold text-met">On</p>
        <FormMessage notice={enableState.notice} />
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold">Your password, to turn it off</span>
          <input name="password" type="password" autoComplete="current-password" required className="field" />
        </label>
        <FormMessage error={disableState.error} />
        <button type="submit" disabled={disabling} className="btn">
          {disabling ? "Turning off…" : "Turn off two-step sign-in"}
        </button>
      </form>
    );
  }
  if (!setup.secret) {
    return (
      <form action={begin} className="space-y-3">
        <p className="font-semibold text-ink-2">Off</p>
        <FormMessage error={setup.error} notice={disableState.notice} />
        <button type="submit" disabled={starting} className="btn btn-primary">
          {starting ? "Preparing…" : "Set up an authenticator app"}
        </button>
      </form>
    );
  }
  return (
    <form action={enable} className="space-y-4">
      <ol className="list-decimal space-y-4 pl-5 text-[14px]">
        <li>
          In an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password and others), add an account
          by scanning this code.
          {/* The QR code is SVG drawn by the API (segno) from the secret, not user content. */}
          <div className="mt-3 w-fit rounded-lg border border-rule bg-paper p-2 [&_svg]:size-44" dangerouslySetInnerHTML={{ __html: setup.qr_svg! }} />
        </li>
        <li>
          No camera? Type this key instead:
          <span className="code mt-1 block break-all text-ink select-all">{setup.secret!.match(/.{1,4}/g)!.join(" ")}</span>
        </li>
        <li>
          <label className="block space-y-1.5">
            <span>Enter the six-digit code the app shows</span>
            <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required className="field code max-w-40 tracking-[0.2em]" />
          </label>
        </li>
      </ol>
      <FormMessage error={enableState.error} />
      <button type="submit" disabled={enabling} className="btn btn-primary">
        {enabling ? "Checking…" : "Turn on two-step sign-in"}
      </button>
    </form>
  );
}

export function SessionsForm({ others }: { others: number }) {
  const [state, action, pending] = useActionState<AccountState>(revokeOthers, initial);
  return (
    <form action={action} className="space-y-3">
      <p>
        {others === 0
          ? "Only this device is signed in."
          : `Signed in on this device and ${others} other${others === 1 ? "" : "s"}.`}
      </p>
      <FormMessage {...state} />
      {others > 0 && (
        <button type="submit" disabled={pending} className="btn">
          {pending ? "Signing out…" : "Sign out everywhere else"}
        </button>
      )}
    </form>
  );
}
