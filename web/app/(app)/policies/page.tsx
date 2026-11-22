import type { Metadata } from "next";
import Link from "next/link";

import { api } from "@/lib/api";
import { moment } from "@/lib/format";

export const metadata: Metadata = { title: "Policies" };

type Version = {
  version_id: number;
  policy_id: string;
  version: number;
  title: string;
  status: "draft" | "published" | "retired";
  created_at: string;
  published_at: string | null;
  source_document: string | null;
  procedure_codes: string[] | null;
};

const STATUS_STYLE = {
  published: "bg-met-soft text-met",
  draft: "bg-missing-soft text-missing",
  retired: "bg-tint text-ink-2",
};

export default async function PoliciesPage() {
  const versions = await api<Version[]>("/policies");
  const byPolicy = Map.groupBy(versions, (v) => v.policy_id);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="title">Policies</h1>
        <p className="mt-1 max-w-2xl text-ink-2">
          Coverage criteria drawn from CMS Local Coverage Determinations. Each criterion quotes the
          sentence it comes from. Only the published version of a policy is used for reviews.
        </p>
      </div>
      <div className="sheet divide-y divide-rule">
        {[...byPolicy.values()].map((list) => (
          <section key={list[0].policy_id} className="p-5">
            <h2 className="font-serif text-lg font-semibold">{list[0].title}</h2>
            <p className="mt-0.5 text-[13px] text-ink-2">
              {list[0].source_document} · codes{" "}
              <span className="code">{(list[0].procedure_codes ?? []).join(", ")}</span>
            </p>
            <ul className="mt-3 space-y-1.5">
              {list.map((v) => (
                <li key={v.version_id} className="flex flex-wrap items-center gap-3 text-sm">
                  <Link href={`/policies/${v.version_id}`} className="font-semibold text-accent hover:underline">
                    Version {v.version}
                  </Link>
                  <span className={`rounded px-1.5 py-0.5 text-[12px] font-semibold capitalize ${STATUS_STYLE[v.status]}`}>
                    {v.status}
                  </span>
                  <span className="text-ink-2">
                    {v.published_at ? `published ${moment(v.published_at)}` : `added ${moment(v.created_at)}`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
