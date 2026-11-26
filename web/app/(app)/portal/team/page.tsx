import type { Metadata } from "next";

import { api } from "@/lib/api";
import { moment } from "@/lib/format";

import { InviteColleague } from "./invite";

export const metadata: Metadata = { title: "Team" };

type Team = {
  practice: { name: string; npi: string };
  people: { user_id: number; name: string; email: string; last_login_at: string | null; invited: boolean }[];
};

export default async function TeamPage() {
  const { practice, people } = await api<Team>("/portal/team");
  return (
    <div className="max-w-[1080px] space-y-8">
      <div className="rise">
        <h1 className="title">{practice.name}</h1>
        <p className="mt-1 text-ink-2">
          NPI <span className="code">{practice.npi}</span> · everyone here sees and answers the practice&rsquo;s requests.
        </p>
      </div>
      <section aria-labelledby="people-heading">
        <h2 id="people-heading" className="heading">
          {people.length} {people.length === 1 ? "person" : "people"}
        </h2>
        <ul className="sheet mt-3 divide-y divide-rule text-sm">
          {people.map((p) => (
            <li key={p.user_id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3">
              <span>
                <span className="block font-semibold">{p.name}</span>
                <span className="text-[13px] text-ink-2">{p.email}</span>
              </span>
              <span className={p.invited ? "font-semibold text-missing" : "text-ink-2"}>
                {p.invited ? "Invited" : p.last_login_at ? `Last sign-in ${moment(p.last_login_at)}` : "Never signed in"}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="add-heading" className="sheet p-5 sm:p-6">
        <h2 id="add-heading" className="font-serif text-[22px] font-semibold">
          Add a colleague
        </h2>
        <p className="mt-1 text-[14px] text-ink-2">They get an email with a link to choose their own password.</p>
        <InviteColleague />
      </section>
    </div>
  );
}
