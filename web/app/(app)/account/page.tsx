import type { Metadata } from "next";

import { api } from "@/lib/api";
import { ROLE_DUTY, day, moment } from "@/lib/format";
import type { Role } from "@/lib/types";

import { MfaSection, NameForm, PasswordForm, SessionsForm } from "./forms";

export const metadata: Metadata = { title: "Your account" };

type Account = {
  user_id: number;
  email: string;
  name: string;
  role: Role;
  created_at: string;
  last_login_at: string | null;
  mfa_enabled: boolean;
  other_sessions: number;
};

function Section({ title, about, children }: { title: string; about: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-rule py-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:gap-12">
      <div>
        <h2 className="font-serif text-[22px] font-semibold">{title}</h2>
        <p className="mt-1 max-w-[42ch] text-[14px] text-ink-2">{about}</p>
      </div>
      <div className="max-w-lg">{children}</div>
    </section>
  );
}

export default async function AccountPage() {
  const me = await api<Account>("/auth/account");
  return (
    <div className="max-w-[1080px]">
      <div className="rise pb-8">
        <h1 className="title">Your account</h1>
        <p className="mt-2 text-ink-2">
          {me.email} · <span className="capitalize">{me.role}</span> · member since {day(me.created_at)}
        </p>
      </div>
      <Section title="Name" about="Shown beside every correction and decision you record, and in the audit trail.">
        <NameForm name={me.name} />
      </Section>
      <Section title="Role" about="Set by your administrator. It decides what you may do.">
        <p className="font-semibold capitalize">{me.role}</p>
        <p className="mt-1 text-[14px] text-ink-2">{ROLE_DUTY[me.role]}</p>
      </Section>
      <Section title="Password" about="Changing it signs out every other device signed in to this account.">
        <PasswordForm email={me.email} />
      </Section>
      <Section
        title="Two-step sign-in"
        about="After your password, Indicium also asks for a six-digit code from an authenticator app on your phone."
      >
        <MfaSection enabled={me.mfa_enabled} />
      </Section>
      <Section
        title="Devices"
        about={me.last_login_at ? `Last sign-in ${moment(me.last_login_at)}.` : "Where this account is signed in."}
      >
        <SessionsForm others={me.other_sessions} />
      </Section>
    </div>
  );
}
