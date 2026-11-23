import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Icon } from "@/components/icons";
import { ApiError, api } from "@/lib/api";
import { moment } from "@/lib/format";
import type { Principal } from "@/lib/types";

import { PolicyView, type PolicyNode } from "./policy-view";
import { PublishButton } from "./publish";

export const metadata: Metadata = { title: "Policy" };

type VersionDetail = {
  version_id: number;
  version: number;
  status: string;
  published_at: string | null;
  document: {
    title: string;
    source: { document_id: string; url: string | null; contractor: string | null; effective_date: string | null };
    procedure_codes: { code: string; description: string }[];
    diagnosis_codes: string[];
    criteria: PolicyNode;
    source_text: string;
  };
  source_spans: Record<string, [number, number] | null>;
};

export default async function PolicyVersionPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  if (!/^\d+$/.test(versionId)) notFound();
  let v: VersionDetail;
  let me: Principal;
  try {
    [v, me] = await Promise.all([api<VersionDetail>(`/policies/versions/${versionId}`), api<Principal>("/auth/me")]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const doc = v.document;

  return (
    <div className="space-y-8">
      <Link href="/policies" className="group inline-flex items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        <Icon name="back" className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
        Policies
      </Link>
      <header className="rise flex flex-wrap items-end justify-between gap-x-10 gap-y-4 border-b border-rule pb-6">
        <div>
          <h1 className="title text-[clamp(28px,3.2vw,38px)]">{doc.title}</h1>
          <p className="mt-2 text-ink-2">
            Version {v.version} · <span className="capitalize">{v.status}</span>
            {v.published_at && ` ${moment(v.published_at)}`} · {doc.source.document_id}
            {doc.source.contractor && ` · ${doc.source.contractor}`}
          </p>
          <p className="mt-1 text-sm">
            Codes <span className="code">{doc.procedure_codes.map((c) => c.code).join(", ")}</span> ·{" "}
            {doc.diagnosis_codes.length ? `${doc.diagnosis_codes.length} covered diagnosis codes` : "no diagnosis list"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {doc.source.url && (
            <a href={doc.source.url} target="_blank" rel="noreferrer" className="btn">
              CMS source
              <Icon name="external" />
            </a>
          )}
          {me.role === "admin" && v.status !== "published" && <PublishButton versionId={v.version_id} />}
        </div>
      </header>

      <PolicyView criteria={doc.criteria} sourceText={doc.source_text} spans={v.source_spans} />
    </div>
  );
}
