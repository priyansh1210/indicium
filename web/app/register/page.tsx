import type { Metadata } from "next";

import { PublicShell } from "@/components/public-shell";

import { RegisterForm } from "./form";

export const metadata: Metadata = { title: "Register your practice" };

export default function RegisterPage() {
  return (
    <PublicShell
      title="Register your practice"
      lead="Send prior-authorization requests with the clinical notes, follow each one, and answer when the reviewer asks for more. Decisions arrive by email with their reason."
    >
      <RegisterForm />
    </PublicShell>
  );
}
