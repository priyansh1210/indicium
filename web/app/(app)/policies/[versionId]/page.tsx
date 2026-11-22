import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Icon } from "@/components/icons";
import { ApiError, api } from "@/lib/api";
import { moment } from "@/lib/format";
import { segments } from "@/lib/marks";
import type { Principal } from "@/lib/types";

import { PublishButton } from "./publish";

export const metadata: Metadata = { title: "Policy" };

type Node =
  | { type: "criterion"; id: string; kind: "required" | "exclusion"; text: string; guidance: string }
  | { type: "group"; op: "all" | "any" | "at_least"; n: number | null; label: string; items: Node[] };

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
    criteria: Node;
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
  const marks = Object.entries(v.source_spans).flatMap(([criterion, span]) =>
    span ? [{ start: span[0], end: span[1], criterion }] : [],
  );

  return (
    <div className="space-y-5">
      <Link href="/policies" className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
        <Icon name="back" />
        Policies
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="title">{doc.title}</h1>
          <p className="mt-1 text-ink-2">
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

      <div className="grid items-start gap-5 min-[1100px]:grid-cols-2">
        <section className="sheet p-5" aria-labelledby="criteria-heading">
          <h2 id="criteria-heading" className="heading">
            Criteria
          </h2>
          <div className="mt-3">
            <Tree node={doc.criteria} />
          </div>
        </section>
        <section className="sheet p-5" aria-labelledby="source-heading">
          <h2 id="source-heading" className="heading">
            Policy text
          </h2>
          <p className="mt-1 text-[13px] text-ink-2">Highlighted: the sentence each criterion is drawn from.</p>
          <div className="mt-3 max-h-[75dvh] overflow-y-auto font-serif leading-[1.7] whitespace-pre-wrap">
            {segments(doc.source_text, marks).map((s, i) =>
              s.criteria.length ? (
                <mark key={i} id={`source-${s.criteria[0]}`} className="evidence" title={s.criteria.join(", ")}>
                  {s.text}
                </mark>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Tree({ node }: { node: Node }) {
  if (node.type === "criterion") {
    return (
      <div className="py-2">
        <a href={`#source-${node.id}`} className="hover:text-accent">
          {node.text}
        </a>
        <p className="text-[13px] text-ink-2">
          <span className="code">{node.id}</span>
          {node.kind === "exclusion" && " · exclusion"}
        </p>
        {node.guidance && <p className="mt-1 text-[13px] text-ink-2">{node.guidance}</p>}
      </div>
    );
  }
  const op = node.op === "all" ? "All of these" : node.op === "any" ? "Any one of these" : `At least ${node.n} of these`;
  return (
    <div className="border-l-2 border-rule pl-3">
      <p className="py-1 text-[13px]">
        <strong>{op}</strong> · <span className="text-ink-2">{node.label}</span>
      </p>
      <div className="divide-y divide-rule">
        {node.items.map((child, i) => (
          <Tree key={i} node={child} />
        ))}
      </div>
    </div>
  );
}
