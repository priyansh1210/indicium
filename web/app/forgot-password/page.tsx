import type { Metadata } from "next";

import { PublicShell } from "@/components/public-shell";

import { ForgotForm } from "./form";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <PublicShell
      title="Reset your password"
      lead="Enter the email address you sign in with. We send a link that lets you choose a new password; it works once, for an hour."
    >
      <ForgotForm />
    </PublicShell>
  );
}
