"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import { FindingBadge, RecommendationText } from "@/components/badges";
import { Icon } from "@/components/icons";
import { FINDING_LABEL, day, humanize } from "@/lib/format";
import { segments, type Mark } from "@/lib/marks";
import type { CaseDetail, ChecklistNode, CriterionItem, Principal } from "@/lib/types";

import { correctItem, decide, reviewAgain, type FormState } from "./actions";

const EDITABLE = new Set(["awaiting_nurse", "referred"]);
const CONCERN_LABEL = {
  exclusion: "An exclusion may apply",
  scope: "About a different site or service",
  contradiction: "Contradicts a met item",
};

export function CaseReview({ detail, me }: { detail: CaseDetail; me: Principal }) {
  const { review, checklist, documents } = detail;
  const status = detail.case.status;
  const [active, setActive] = useState<string | null>(null);
  const [docId, setDocId] = useState(documents[0]?.doc_id ?? null);
  const docPanel = useRef<HTMLDivElement>(null);

  const items = useMemo(() => (checklist ? flatten(checklist) : []), [checklist]);
  // Text a person must read: instructions aimed at a reviewer, and the approval check's concerns.
  const passages = useMemo(
    () => [
      ...(review?.injection_hits ?? []).map((h) => ({ ...h, label: "Addressed to an automated reviewer" })),
      ...(review?.concerns ?? []).map((c) => ({
        doc_id: c.doc_id,
        start: c.start,
        end: c.end,
        text: c.quote,
        label: CONCERN_LABEL[c.kind],
      })),
    ],
    [review],
  );
  const marksByDoc = useMemo(() => {
    const byDoc: Record<string, Mark[]> = {};
    for (const item of items)
      for (const e of item.evidence) (byDoc[e.doc_id] ??= []).push({ ...e, criterion: item.id });
    for (const p of passages) (byDoc[p.doc_id] ??= []).push({ start: p.start, end: p.end, suspicious: true });
    return byDoc;
  }, [items, passages]);

  function select(criterionId: string) {
    setActive(criterionId);
    const item = items.find((i) => i.id === criterionId);
    const target = item?.evidence[0]?.doc_id;
    if (target && target !== docId) setDocId(target);
  }

  // Bring the chosen item's first highlight into view once its document is showing.
  useEffect(() => {
    if (!active) return;
    const mark = docPanel.current?.querySelector<HTMLElement>(`[data-criteria~="${CSS.escape(active)}"]`);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    mark?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [active, docId]);

  const canCorrect = !!review && EDITABLE.has(status) && (me.role === "nurse" || me.role === "physician");
  const changed = review && review.recommendation !== review.model_recommendation;

  return (
    <div className="space-y-5">
      {review ? (
        <section className="sheet p-5" aria-labelledby="recommendation-heading">
          <h2 id="recommendation-heading" className="heading">
            Recommendation
          </h2>
          <p className="mt-2 text-xl">
            <RecommendationText value={review.recommendation} />
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-2">
            {review.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {changed && (
            <p className="mt-2 text-[13px] text-ink-2">
              Changed by corrections. The automated review said{" "}
              <RecommendationText value={review.model_recommendation} />.
            </p>
          )}
          {passages.length > 0 && (
            <div className="mt-3 text-sm">
              <p className="font-semibold">Passages to read before deciding (underlined in the document):</p>
              <ul className="mt-1 space-y-1">
                {passages.map((p) => (
                  <li key={`${p.doc_id}-${p.start}-${p.label}`}>
                    <button type="button" className="text-left text-accent hover:underline" onClick={() => setDocId(p.doc_id)}>
                      <span className="font-semibold text-unmet">{p.label}:</span> “{p.text}”{" "}
                      <span className="text-ink-2">in {p.doc_id}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-4 text-[13px] text-ink-2">
            Automated review by {review.provider === "baseline" ? "the keyless retrieval baseline" : review.model} ·{" "}
            {review.prompt_version} · every quote below was checked word for word against the notes.
          </p>
        </section>
      ) : (
        <NotReviewed detail={detail} me={me} />
      )}

      <div className="grid gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-labelledby="checklist-heading" className="space-y-3">
          <h2 id="checklist-heading" className="heading">
            Checklist{detail.policy ? ` · ${detail.policy.title}` : ""}
          </h2>
          {checklist ? (
            <div className="sheet divide-y divide-rule">
              <Group
                node={checklist}
                active={active}
                onSelect={select}
                canCorrect={canCorrect}
                caseId={detail.case.case_id}
                runId={review?.run_id ?? 0}
                root
              />
            </div>
          ) : (
            <p className="sheet bg-tint p-5 text-ink-2">No published policy covers this service code, so there is no checklist.</p>
          )}
          {review && <DecisionPanel detail={detail} me={me} />}
        </section>

        <section aria-labelledby="documents-heading" className="min-[1100px]:sticky min-[1100px]:top-4 min-[1100px]:self-start">
          <h2 id="documents-heading" className="heading">
            Documents
          </h2>
          {documents.length === 0 ? (
            <p className="sheet mt-3 bg-tint p-5 text-ink-2">No clinical documents were submitted with this request.</p>
          ) : (
            <div className="sheet mt-3 overflow-hidden">
              <div role="tablist" aria-label="Documents" className="flex gap-1 overflow-x-auto border-b border-rule p-2">
                {documents.map((d) => (
                  <button
                    key={d.doc_id}
                    role="tab"
                    type="button"
                    aria-selected={d.doc_id === docId}
                    onClick={() => setDocId(d.doc_id)}
                    className={`shrink-0 rounded-md px-3 py-1.5 text-left text-[13px] ${
                      d.doc_id === docId ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-tint"
                    }`}
                  >
                    <span className="block font-semibold capitalize">{humanize(d.kind)}</span>
                    {day(d.written_on)}
                  </button>
                ))}
              </div>
              {documents
                .filter((d) => d.doc_id === docId)
                .map((d) => (
                  <div key={d.doc_id} role="tabpanel" ref={docPanel} className="max-h-[75dvh] overflow-y-auto px-5 py-4">
                    <p className="text-[13px] text-ink-2">
                      {d.author || "Unknown author"} · <span className="code">{d.doc_id}</span>
                    </p>
                    <div className="mt-3 font-serif text-base leading-[1.7] whitespace-pre-wrap">
                      {segments(d.text, marksByDoc[d.doc_id] ?? []).map((s, i) =>
                        s.criteria.length ? (
                          <mark
                            key={i}
                            className="evidence"
                            data-criteria={s.criteria.join(" ")}
                            data-active={active !== null && s.criteria.includes(active)}
                            onClick={() => select(s.criteria[0])}
                          >
                            {s.text}
                          </mark>
                        ) : s.suspicious ? (
                          <mark key={i} className="suspicious">
                            {s.text}
                          </mark>
                        ) : (
                          <span key={i}>{s.text}</span>
                        ),
                      )}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function flatten(node: ChecklistNode): CriterionItem[] {
  return node.type === "criterion" ? [node] : node.items.flatMap(flatten);
}

const OP_TEXT = { all: "All of these", any: "Any one of these", at_least: "At least" } as const;

type ItemProps = {
  active: string | null;
  onSelect: (id: string) => void;
  canCorrect: boolean;
  caseId: number;
  runId: number;
};

function Group({ node, root, ...props }: ItemProps & { node: ChecklistNode; root?: boolean }) {
  if (node.type === "criterion") return <Item item={node} {...props} />;
  return (
    <div className={root ? "divide-y divide-rule" : "ml-4 border-l-2 border-rule"}>
      <p className={`px-4 py-2 text-[13px] text-ink-2 ${root ? "bg-tint" : ""}`}>
        <span className="font-semibold text-ink">
          {node.op === "at_least" ? `${OP_TEXT.at_least} ${node.n} of these` : OP_TEXT[node.op]}
        </span>{" "}
        · {node.label}
      </p>
      <div className="divide-y divide-rule">
        {node.items.map((child) => (
          <Group key={child.type === "criterion" ? child.id : child.label} node={child} {...props} />
        ))}
      </div>
    </div>
  );
}

function Item({ item, active, onSelect, canCorrect, caseId, runId }: ItemProps & { item: CriterionItem }) {
  const [correcting, setCorrecting] = useState(false);
  const selected = active === item.id;
  const lowConfidence = item.confidence !== null && item.confidence < 0.6 && !item.override;
  return (
    <article
      id={`item-${item.id}`}
      className={`px-4 py-3 ${selected ? "bg-accent-soft/50" : ""}`}
      aria-current={selected ? "true" : undefined}
    >
      <div className="flex flex-col items-start gap-1.5 sm:flex-row sm:gap-3">
        <FindingBadge finding={item.effective} />
        <button type="button" onClick={() => onSelect(item.id)} className="text-left hover:text-accent">
          {item.text}
          {item.kind === "exclusion" && (
            <span className="mt-0.5 block text-[13px] text-ink-2">Exclusion: it blocks coverage only if the notes show it.</span>
          )}
        </button>
      </div>

      {item.evidence.length > 0 && (
        <ul className="mt-2 space-y-1.5 pl-1">
          {item.evidence.map((e) => (
            <li key={`${e.doc_id}-${e.start}`}>
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                className="w-full rounded-md border-l-4 border-marker-strong bg-tint px-3 py-1.5 text-left font-serif text-[15px] hover:bg-marker/40"
              >
                “{e.quote}” <span className="font-sans text-[12px] text-ink-2">{e.doc_id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {item.rationale && <p className="mt-2 text-[13px] text-ink-2">{item.rationale}</p>}
      {lowConfidence && (
        <p className="mt-1 text-[13px] text-ink-2">Low confidence ({Math.round(item.confidence! * 100)}%): check this item yourself.</p>
      )}
      {item.dropped.length > 0 && (
        <details className="mt-2 text-[13px]">
          <summary className="cursor-pointer text-ink-2">
            {item.dropped.length} quoted passage{item.dropped.length > 1 ? "s" : ""} discarded
          </summary>
          <ul className="mt-1 space-y-1 rounded-md bg-tint p-2">
            {item.dropped.map((d, i) => (
              <li key={i}>
                <span className="line-through decoration-ink-2/50">“{d.quote}”</span>{" "}
                <span className="text-ink-2">({d.reason})</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {item.override && (
        <p className="mt-2 rounded-md bg-accent-soft px-3 py-2 text-[13px]">
          <Icon name="pen" className="mr-1 inline size-3.5" />
          {item.override.by_name} set this to <strong>{FINDING_LABEL[item.override.finding]}</strong>
          {item.finding && ` (was ${FINDING_LABEL[item.finding]})`}: {item.override.reason}
        </p>
      )}
      {canCorrect &&
        (correcting ? (
          <CorrectionForm caseId={caseId} runId={runId} item={item} onDone={() => setCorrecting(false)} />
        ) : (
          <button type="button" onClick={() => setCorrecting(true)} className="mt-2 text-[13px] font-semibold text-accent hover:underline">
            Correct this item
          </button>
        ))}
    </article>
  );
}

function CorrectionForm({ caseId, runId, item, onDone }: { caseId: number; runId: number; item: CriterionItem; onDone: () => void }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    correctItem.bind(null, caseId, runId, item.id),
    { error: null },
  );
  useEffect(() => {
    if (state.done) onDone();
  }, [state.done, onDone]);
  return (
    <form action={action} className="mt-3 space-y-2 rounded-lg border border-rule p-3">
      <fieldset>
        <legend className="text-[13px] font-semibold">What do the notes show?</legend>
        <div className="mt-1 flex flex-wrap gap-3 text-sm">
          {(["documented", "contradicted", "absent"] as const).map((f) => (
            <label key={f} className="flex items-center gap-1.5">
              <input type="radio" name="finding" value={f} defaultChecked={item.effective === f} required />
              {FINDING_LABEL[f]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block text-[13px] font-semibold">
        Reason (kept in the audit trail)
        <textarea name="reason" required minLength={3} maxLength={2000} rows={2} className="field mt-1 font-normal" />
      </label>
      {state.error && <p role="alert" className="text-[13px] text-unmet">{state.error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn btn-primary h-8">
          {pending ? "Saving…" : "Save correction"}
        </button>
        <button type="button" onClick={onDone} className="btn h-8">
          Cancel
        </button>
      </div>
    </form>
  );
}

const OUTCOMES: Record<string, { value: string; label: string }[]> = {
  awaiting_nurse: [
    { value: "approved", label: "Approve" },
    { value: "pended", label: "Pend for information" },
    { value: "referred", label: "Refer to a physician" },
  ],
  referred: [
    { value: "approved", label: "Approve" },
    { value: "pended", label: "Pend for information" },
    { value: "denied", label: "Deny" },
  ],
};

function DecisionPanel({ detail, me }: { detail: CaseDetail; me: Principal }) {
  const status = detail.case.status;
  const allowed =
    (status === "awaiting_nurse" && (me.role === "nurse" || me.role === "physician")) ||
    (status === "referred" && me.role === "physician");
  const [state, action, pending] = useActionState<FormState, FormData>(
    decide.bind(null, detail.case.case_id, detail.review!.run_id),
    { error: null },
  );
  if (!allowed) {
    const why =
      status === "referred"
        ? "A physician reviewer decides referred cases."
        : EDITABLE.has(status)
          ? "Your role can read this case but not decide it."
          : null;
    return why ? <p className="sheet bg-tint p-4 text-sm text-ink-2">{why}</p> : null;
  }
  return (
    <form action={action} className="sheet space-y-3 p-5" aria-labelledby="decision-heading">
      <h2 id="decision-heading" className="heading">
        Decision
      </h2>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Outcome</legend>
        {OUTCOMES[status].map((o) => (
          <label key={o.value} className="btn cursor-pointer has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent">
            <input type="radio" name="outcome" value={o.value} required className="sr-only" />
            {o.label}
          </label>
        ))}
      </fieldset>
      <label className="block text-[13px] font-semibold">
        Reason (sent with the decision and kept in the audit trail)
        <textarea name="reason" required minLength={3} maxLength={4000} rows={3} className="field mt-1 font-normal" />
      </label>
      {state.error && <p role="alert" className="text-sm text-unmet">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Recording…" : "Record decision"}
      </button>
    </form>
  );
}

function NotReviewed({ detail, me }: { detail: CaseDetail; me: Principal }) {
  const failed = detail.case.status === "failed";
  const last = detail.runs[0];
  const [state, action, pending] = useActionState<FormState, FormData>(
    () => reviewAgain(detail.case.case_id),
    { error: null },
  );
  return (
    <section className="sheet bg-tint p-5">
      <p className="font-semibold">{failed ? "The automated review failed." : "The automated review has not finished yet."}</p>
      {failed && last?.error && <p className="mt-1 text-sm text-ink-2">Last error: {last.error}</p>}
      {failed && me.role !== "viewer" && (
        <form action={action} className="mt-3">
          <button type="submit" disabled={pending} className="btn">
            {pending ? "Queuing…" : "Review again"}
          </button>
          {state.error && <p role="alert" className="mt-2 text-sm text-unmet">{state.error}</p>}
        </form>
      )}
    </section>
  );
}
