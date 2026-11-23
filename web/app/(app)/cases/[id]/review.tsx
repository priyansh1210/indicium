"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import { FindingBadge, RecommendationText } from "@/components/badges";
import { Icon } from "@/components/icons";
import { FINDING_LABEL, day, humanize } from "@/lib/format";
import { centreIn, segments, type Mark } from "@/lib/marks";
import type { CaseDetail, ChecklistNode, CriterionItem, Principal } from "@/lib/types";

import { correctItem, decide, reviewAgain, type FormState } from "./actions";

const EDITABLE = new Set(["awaiting_nurse", "referred"]);
const CONCERN_LABEL = {
  exclusion: "An exclusion may apply",
  scope: "About a different site or service",
  contradiction: "Contradicts a met item",
};

function reduceMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function CaseReview({ detail, me }: { detail: CaseDetail; me: Principal }) {
  const { review, checklist, documents } = detail;
  const status = detail.case.status;
  const [active, setActive] = useState<string | null>(null);
  const [docId, setDocId] = useState(documents[0]?.doc_id ?? null);
  const docPanel = useRef<HTMLDivElement>(null);
  const fromNote = useRef(false);

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
  function select(criterionId: string, viaNote = false) {
    fromNote.current = viaNote;
    setActive(criterionId);
    const item = items.find((i) => i.id === criterionId);
    const target = item?.evidence[0]?.doc_id;
    if (!viaNote && target && target !== docId) setDocId(target);
  }

  // Choosing an item brings its first highlight into view; choosing a highlight brings its item.
  useEffect(() => {
    if (!active) return;
    const behavior = reduceMotion() ? "auto" : "smooth";
    if (fromNote.current) {
      document.getElementById(`item-${active}`)?.scrollIntoView({ block: "nearest", behavior });
      return;
    }
    const panel = docPanel.current;
    const mark = panel?.querySelector<HTMLElement>(`[data-criteria~="${CSS.escape(active)}"]`);
    if (panel && mark) centreIn(panel, mark, behavior);
  }, [active, docId]);

  const canCorrect = !!review && EDITABLE.has(status) && (me.role === "nurse" || me.role === "physician");
  const changed = review && review.recommendation !== review.model_recommendation;

  return (
    <div className="space-y-10">
      {review ? (
        <section aria-labelledby="recommendation-heading" className="rise space-y-6" style={{ "--i": 1 } as React.CSSProperties}>
          <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div>
              <h2 id="recommendation-heading" className="text-[13px] font-semibold text-ink-2">
                Recommendation
              </h2>
              <p className="mt-1 font-serif text-[clamp(28px,3vw,36px)] leading-tight">
                <RecommendationText value={review.recommendation} />
              </p>
              <ul className="mt-3 space-y-1 text-[15px]">
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
            </div>
            <div className="lg:border-l lg:border-rule lg:pl-8">
              <p className="text-[13px] leading-relaxed text-ink-2">
                Reviewed by {review.provider === "baseline" ? "the keyless retrieval baseline" : review.model} with prompt{" "}
                <span className="code">{review.prompt_version}</span>. Every quote below was found word for word in the notes.
              </p>
            </div>
          </div>
          {passages.length > 0 && (
            <div className="rounded-xl border border-unmet/25 bg-unmet-soft/60 p-5">
              <p className="flex items-center gap-2 font-semibold text-unmet">
                <Icon name="shield" />
                Read {passages.length === 1 ? "this passage" : `these ${passages.length} passages`} before deciding
              </p>
              <ul className="mt-3 space-y-2">
                {passages.map((p) => (
                  <li key={`${p.doc_id}-${p.start}-${p.label}`}>
                    <button
                      type="button"
                      className="text-left hover:underline"
                      onClick={() => {
                        fromNote.current = false;
                        setDocId(p.doc_id);
                        document.getElementById("documents-heading")?.scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" });
                      }}
                    >
                      <span className="font-semibold text-unmet">{p.label}:</span>{" "}
                      <span className="font-serif">“{p.text}”</span> <span className="text-[13px] text-ink-2">in {p.doc_id}, underlined</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ) : (
        <NotReviewed detail={detail} me={me} />
      )}

      <div className="grid gap-8 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-labelledby="checklist-heading" className="space-y-4">
          <h2 id="checklist-heading" className="flex flex-wrap items-baseline gap-x-2 font-serif text-[22px] font-semibold">
            Checklist
            {detail.policy && <span className="font-sans text-sm font-normal text-ink-2">{detail.policy.title}</span>}
          </h2>
          {checklist ? (
            <div className="sheet overflow-hidden">
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

        <section aria-labelledby="documents-heading" className="scroll-mt-6 min-[1100px]:sticky min-[1100px]:top-6 min-[1100px]:self-start">
          <h2 id="documents-heading" className="font-serif text-[22px] font-semibold">
            Documents
          </h2>
          {documents.length === 0 ? (
            <p className="sheet mt-4 bg-tint p-5 text-ink-2">No clinical documents were submitted with this request.</p>
          ) : (
            <div className="sheet mt-4 overflow-hidden">
              <div role="tablist" aria-label="Documents" className="flex gap-1 overflow-x-auto border-b border-rule px-3">
                {documents.map((d) => (
                  <button
                    key={d.doc_id}
                    role="tab"
                    type="button"
                    aria-selected={d.doc_id === docId}
                    onClick={() => {
                      fromNote.current = false;
                      setDocId(d.doc_id);
                    }}
                    className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-left text-[13px] transition-colors duration-150 ${
                      d.doc_id === docId ? "border-ink text-ink" : "border-transparent text-ink-2 hover:text-ink"
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
                  <div key={d.doc_id} role="tabpanel" ref={docPanel} className="max-h-[75dvh] overflow-y-auto px-6 py-5">
                    <p className="text-[13px] text-ink-2">
                      {d.author || "Unknown author"} · <span className="code">{d.doc_id}</span>
                    </p>
                    <div className="mt-3 font-serif text-[16.5px] leading-[1.75] whitespace-pre-wrap">
                      {segments(d.text, marksByDoc[d.doc_id] ?? []).map((s, i) =>
                        s.criteria.length ? (
                          <mark
                            key={i}
                            className="evidence"
                            data-criteria={s.criteria.join(" ")}
                            data-active={active !== null && s.criteria.includes(active)}
                            onClick={() => select(s.criteria[0], true)}
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
    <div className={root ? "" : "ml-5 border-l border-rule"}>
      <p className={`px-5 py-2.5 text-[13px] text-ink-2 ${root ? "border-b border-rule bg-tint" : ""}`}>
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
      className={`scroll-mt-6 px-5 py-4 transition-[background-color,box-shadow] duration-300 ${
        selected ? "bg-marker/25 shadow-[inset_3px_0_0_var(--color-marker-strong)]" : ""
      }`}
      aria-current={selected ? "true" : undefined}
    >
      <div className="flex flex-col items-start gap-1.5 sm:flex-row sm:gap-3">
        <FindingBadge finding={item.effective} />
        <button type="button" onClick={() => onSelect(item.id)} className="text-left leading-snug hover:text-accent">
          {item.text}
          {item.kind === "exclusion" && (
            <span className="mt-0.5 block text-[13px] text-ink-2">Exclusion: it blocks coverage only if the notes show it.</span>
          )}
        </button>
      </div>

      {item.evidence.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {item.evidence.map((e) => (
            <li key={`${e.doc_id}-${e.start}`}>
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                className={`w-full rounded-r-md border-l-[3px] border-marker-strong px-3 py-2 text-left font-serif text-[15px] leading-relaxed transition-colors duration-200 ${
                  selected ? "bg-marker/45" : "bg-tint hover:bg-marker/35"
                }`}
              >
                “{e.quote}” <span className="font-sans text-[12px] text-ink-2">{e.doc_id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {item.rationale && <p className="mt-2.5 text-[13px] leading-relaxed text-ink-2">{item.rationale}</p>}
      {lowConfidence && (
        <p className="mt-1 text-[13px] font-semibold text-missing">
          Low confidence ({Math.round(item.confidence! * 100)}%): check this item yourself.
        </p>
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
        <p className="mt-2.5 rounded-md bg-accent-soft px-3 py-2 text-[13px]">
          <Icon name="pen" className="mr-1 inline size-3.5" />
          {item.override.by_name} set this to <strong>{FINDING_LABEL[item.override.finding]}</strong>
          {item.finding && ` (was ${FINDING_LABEL[item.finding]})`}: {item.override.reason}
        </p>
      )}
      {canCorrect &&
        (correcting ? (
          <CorrectionForm caseId={caseId} runId={runId} item={item} onDone={() => setCorrecting(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setCorrecting(true)}
            className="mt-2.5 inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline"
          >
            <Icon name="pen" className="size-3.5" />
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
    <form action={action} className="rise mt-3 space-y-3 rounded-lg border border-rule bg-paper p-4">
      <fieldset>
        <legend className="text-[13px] font-semibold">What do the notes show?</legend>
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          {(["documented", "contradicted", "absent"] as const).map((f) => (
            <label
              key={f}
              className="flex cursor-pointer items-center gap-1.5 rounded-md border border-rule px-2.5 py-1.5 has-[:checked]:border-ink has-[:checked]:bg-tint"
            >
              <input type="radio" name="finding" value={f} defaultChecked={item.effective === f} required className="accent-ink" />
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
        <button type="submit" disabled={pending} className="btn btn-primary h-9">
          {pending ? "Saving…" : "Save correction"}
        </button>
        <button type="button" onClick={onDone} className="btn h-9">
          Cancel
        </button>
      </div>
    </form>
  );
}

type Outcome = { value: string; label: string; effect: string; tone: string };
const APPROVE: Outcome = { value: "approved", label: "Approve", effect: "The request meets the policy.", tone: "has-[:checked]:border-met has-[:checked]:bg-met-soft" };
const PEND: Outcome = { value: "pended", label: "Pend for information", effect: "Ask the provider for what is missing.", tone: "has-[:checked]:border-missing has-[:checked]:bg-missing-soft" };
const OUTCOMES: Record<string, Outcome[]> = {
  awaiting_nurse: [
    APPROVE,
    PEND,
    { value: "referred", label: "Refer to a physician", effect: "A physician reviewer decides.", tone: "has-[:checked]:border-accent has-[:checked]:bg-accent-soft" },
  ],
  referred: [
    APPROVE,
    PEND,
    { value: "denied", label: "Deny", effect: "Recorded as your decision as physician.", tone: "has-[:checked]:border-unmet has-[:checked]:bg-unmet-soft" },
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
    return why ? <p className="rounded-xl bg-tint p-4 text-sm text-ink-2">{why}</p> : null;
  }
  return (
    <form action={action} className="sheet space-y-4 p-5" aria-labelledby="decision-heading">
      <h2 id="decision-heading" className="font-serif text-[22px] font-semibold">
        Decision
      </h2>
      <fieldset className="grid gap-2 sm:grid-cols-3">
        <legend className="sr-only">Outcome</legend>
        {OUTCOMES[status].map((o) => (
          <label
            key={o.value}
            className={`cursor-pointer rounded-lg border border-rule p-3 transition-colors duration-150 hover:bg-tint ${o.tone} has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent`}
          >
            <input type="radio" name="outcome" value={o.value} required className="sr-only" />
            <span className="block font-semibold">{o.label}</span>
            <span className="mt-0.5 block text-[13px] text-ink-2">{o.effect}</span>
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
    <section className={`rounded-xl p-5 ${failed ? "bg-unmet-soft/60" : "bg-tint"}`}>
      <p className="font-serif text-xl font-semibold">{failed ? "The automated review failed." : "The automated review has not finished yet."}</p>
      <p className="mt-1 text-sm text-ink-2">
        {failed
          ? "Nothing was recommended, so there is nothing to decide yet. Queue it again once the cause is fixed."
          : "The case is queued. Reload this page once a worker has reviewed it."}
      </p>
      {failed && last?.error && <p className="mt-2 text-sm text-ink-2">Last error: {last.error}</p>}
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
