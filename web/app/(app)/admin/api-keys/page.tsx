import type { Metadata } from "next";

import { api } from "@/lib/api";
import { moment } from "@/lib/format";

import { NewKeyForm, RevokeButton } from "./forms";

export const metadata: Metadata = { title: "API keys" };

type Key = {
  key_id: number;
  name: string;
  created_by: string;
  created_at: string;
  revoked_at: string | null;
  cases_submitted: number;
};

export default async function ApiKeysPage() {
  const keys = await api<Key[]>("/api-keys");
  return (
    <div className="space-y-8">
      <section aria-labelledby="key-heading" className="rise sheet p-5 sm:p-6" style={{ "--i": 2 } as React.CSSProperties}>
        <h2 id="key-heading" className="font-serif text-[22px] font-semibold">
          Connect a submitting system
        </h2>
        <p className="mt-1 max-w-[70ch] text-[14px] text-ink-2">
          An EHR or provider portal sends requests with its own key. A key can only submit, and only sees the cases it
          submitted.
        </p>
        <dl className="mt-4 grid max-w-2xl grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-[14px]">
          <dt className="text-ink-2">JSON request</dt>
          <dd className="code text-ink">POST /api/cases</dd>
          <dt className="text-ink-2">FHIR R4 Bundle</dt>
          <dd className="code text-ink">POST /api/cases/fhir</dd>
          <dt className="text-ink-2">Header</dt>
          <dd className="code break-all text-ink">Authorization: Bearer ik_…</dd>
        </dl>
        <NewKeyForm />
      </section>

      <section aria-labelledby="keys-heading" className="space-y-3">
        <h2 id="keys-heading" className={keys.length ? "heading" : "sr-only"}>
          {keys.filter((k) => !k.revoked_at).length} keys in use
        </h2>
        {keys.length === 0 ? (
          <p className="sheet bg-tint px-6 py-10 text-center text-ink-2">No keys yet. Requests arrive only through people signing in.</p>
        ) : (
          <div className="sheet overflow-x-auto">
            <table className="w-full text-left text-sm md:min-w-[720px]">
              <thead className="border-b border-rule text-ink-2 max-md:hidden">
                <tr>
                  {["System", "Created", "Requests submitted", "State", ""].map((h, i) => (
                    <th key={i} scope="col" className="px-4 py-3 text-[13px] font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.key_id} className={`border-b border-rule last:border-0 max-md:grid max-md:gap-1.5 max-md:p-4 ${k.revoked_at ? "text-ink-2" : ""}`}>
                    <td className="px-4 py-3 align-top max-md:p-0">
                      <span className="code text-ink">{k.name}</span>
                    </td>
                    <td className="px-4 py-3 align-top text-ink-2 max-md:p-0">
                      {moment(k.created_at)} by {k.created_by}
                    </td>
                    <td className="px-4 py-3 align-top tabular-nums max-md:p-0">
                      {k.cases_submitted}
                      <span className="md:hidden text-ink-2"> requests submitted</span>
                    </td>
                    <td className={`px-4 py-3 align-top font-semibold max-md:p-0 ${k.revoked_at ? "text-ink-2" : "text-met"}`}>
                      {k.revoked_at ? `Revoked ${moment(k.revoked_at)}` : "In use"}
                    </td>
                    <td className="px-4 py-3 align-top max-md:p-0">{!k.revoked_at && <RevokeButton keyId={k.key_id} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
