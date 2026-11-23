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
  published: "text-met",
  draft: "text-missing",
  retired: "text-ink-2",
};

export default async function PoliciesPage() {
  const versions = await api<Version[]>("/policies");
  const byPolicy = [...Map.groupBy(versions, (v) => v.policy_id).values()];
  return (
    <div className="space-y-8">
      <div className="rise">
        <h1 className="title">Policies</h1>
        <p className="mt-2 max-w-2xl text-ink-2">
          Coverage criteria drawn from CMS Local Coverage Determinations. Each criterion quotes the
          sentence it comes from. Only the published version of a policy is used for reviews.
        </p>
      </div>
      {byPolicy.length === 0 ? (
        <p className="sheet bg-tint px-6 py-12 text-center text-ink-2">
          No policies are loaded. Load one with{" "}
          <span className="code">python -m indicium.policies load --publish data/policies/*.yaml</span>.
        </p>
      ) : (
        <ul className="border-t border-rule">
          {byPolicy.map((list, i) => (
            <li key={list[0].policy_id} className="rise border-b border-rule" style={{ "--i": i + 1 } as React.CSSProperties}>
              <section className="grid gap-4 py-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:gap-10">
                <div>
                  <h2 className="font-serif text-[22px] leading-snug font-semibold">{list[0].title}</h2>
                  <p className="mt-1 text-[13px] text-ink-2">
                    {list[0].source_document} · codes{" "}
                    <span className="code text-ink">{(list[0].procedure_codes ?? []).join(", ")}</span>
                  </p>
                </div>
                <ul className="space-y-2 md:pt-1">
                  {list.map((v) => (
                    <li key={v.version_id} className="flex flex-wrap items-baseline gap-x-3 text-sm">
                      <Link href={`/policies/${v.version_id}`} className="group font-semibold">
                        <span className="stroke stroke-under [--stroke:var(--color-rule)] group-hover:[background-size:100%_38%]">
                          Version {v.version}
                        </span>
                      </Link>
                      <span className={`font-semibold capitalize ${STATUS_STYLE[v.status]}`}>{v.status}</span>
                      <span className="text-ink-2">
                        {v.published_at ? `published ${moment(v.published_at)}` : `added ${moment(v.created_at)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
