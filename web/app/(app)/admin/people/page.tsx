import type { Metadata } from "next";

import { api } from "@/lib/api";
import { moment } from "@/lib/format";
import type { Principal, Role } from "@/lib/types";

import { InviteForm, PersonActions, RoleSelect } from "./forms";

export const metadata: Metadata = { title: "People" };

export type Person = {
  user_id: number;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  created_at: string;
  last_login_at: string | null;
  mfa_enabled: boolean;
  practice: string | null;
  state: "active" | "invited" | "unverified" | "deactivated";
};

const STATE: Record<Person["state"], { label: string; style: string }> = {
  active: { label: "Active", style: "text-met" },
  invited: { label: "Invited", style: "text-missing" },
  unverified: { label: "Email not confirmed", style: "text-missing" },
  deactivated: { label: "Deactivated", style: "text-ink-2" },
};

export default async function PeoplePage() {
  const [people, me] = await Promise.all([api<Person[]>("/users"), api<Principal>("/auth/me")]);
  const active = people.filter((p) => p.active).length;
  return (
    <div className="space-y-8">
      <section aria-labelledby="invite-heading" className="rise sheet p-5 sm:p-6" style={{ "--i": 2 } as React.CSSProperties}>
        <h2 id="invite-heading" className="font-serif text-[22px] font-semibold">
          Invite a person
        </h2>
        <p className="mt-1 text-[14px] text-ink-2">
          They get an email with a link to choose their own password. You never see or set it.
        </p>
        <InviteForm />
      </section>

      <section aria-labelledby="people-heading" className="space-y-3">
        <h2 id="people-heading" className="heading">
          {active} active {active === 1 ? "account" : "accounts"}
          {people.length > active && <span className="font-normal text-ink-2">, {people.length - active} deactivated</span>}
        </h2>
        <div className="sheet overflow-x-auto">
          <table className="w-full text-left text-sm md:min-w-[880px]">
            <thead className="border-b border-rule text-ink-2 max-md:hidden">
              <tr>
                {["Person", "Role", "State", "Two-step", "Last sign-in", ""].map((h, i) => (
                  <th key={i} scope="col" className="px-4 py-3 text-[13px] font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const self = p.user_id === me.user_id;
                return (
                  <tr key={p.user_id} className={`border-b border-rule last:border-0 max-md:grid max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-2 max-md:p-4 ${p.active ? "" : "text-ink-2"}`}>
                    <td className="px-4 py-3 align-middle max-md:col-span-2 max-md:p-0">
                      <span className="block font-semibold text-ink">
                        {p.name}
                        {self && <span className="ml-2 text-[13px] font-normal text-ink-2">you</span>}
                      </span>
                      <span className="text-[13px] text-ink-2">{p.email}</span>
                    </td>
                    <td className="px-4 py-3 align-middle max-md:p-0">
                      {p.practice ? (
                        <span>
                          Provider <span className="block text-[13px] text-ink-2">{p.practice}</span>
                        </span>
                      ) : self || !p.active ? (
                        <span className="capitalize">{p.role}</span>
                      ) : (
                        <RoleSelect userId={p.user_id} role={p.role} name={p.name} />
                      )}
                    </td>
                    <td className={`px-4 py-3 align-middle font-semibold max-md:p-0 ${STATE[p.state].style}`}>{STATE[p.state].label}</td>
                    <td className="px-4 py-3 align-middle max-md:p-0">
                      <span className="md:hidden text-ink-2">Two-step </span>
                      {p.mfa_enabled ? "On" : <span className="text-ink-2">Off</span>}
                    </td>
                    <td className="px-4 py-3 align-middle text-ink-2 tabular-nums max-md:p-0">
                      <span className="md:hidden">Last sign-in </span>
                      {p.last_login_at ? moment(p.last_login_at) : "Never"}
                    </td>
                    <td className="px-4 py-3 align-middle max-md:col-span-2 max-md:p-0 max-md:empty:hidden">{!self && <PersonActions person={p} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
