"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { centreIn, segments } from "@/lib/marks";

export type PolicyNode =
  | { type: "criterion"; id: string; kind: "required" | "exclusion"; text: string; guidance: string }
  | { type: "group"; op: "all" | "any" | "at_least"; n: number | null; label: string; items: PolicyNode[] };

/** Criteria beside the policy text they were drawn from. Choosing a criterion marks its sentence;
 *  choosing a marked sentence brings its criterion into view. */
export function PolicyView({
  criteria,
  sourceText,
  spans,
}: {
  criteria: PolicyNode;
  sourceText: string;
  spans: Record<string, [number, number] | null>;
}) {
  const [active, setActive] = useState<string | null>(null);
  const fromText = useRef(false);
  const textPanel = useRef<HTMLDivElement>(null);
  const parts = useMemo(
    () =>
      segments(
        sourceText,
        Object.entries(spans).flatMap(([criterion, span]) => (span ? [{ start: span[0], end: span[1], criterion }] : [])),
      ),
    [sourceText, spans],
  );

  useEffect(() => {
    if (!active) return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    if (fromText.current) {
      document.getElementById(`criterion-${active}`)?.scrollIntoView({ block: "nearest", behavior });
      return;
    }
    const panel = textPanel.current;
    const mark = panel?.querySelector<HTMLElement>(`[data-criteria~="${CSS.escape(active)}"]`);
    if (panel && mark) centreIn(panel, mark, behavior);
  }, [active]);

  function select(id: string, viaText = false) {
    fromText.current = viaText;
    setActive(id);
  }

  return (
    <div className="grid items-start gap-8 min-[1100px]:grid-cols-2">
      <section aria-labelledby="criteria-heading">
        <h2 id="criteria-heading" className="font-serif text-[22px] font-semibold">
          Criteria
        </h2>
        <div className="sheet mt-4 px-5 py-3">
          <Tree node={criteria} active={active} onSelect={select} spans={spans} />
        </div>
      </section>
      <section aria-labelledby="source-heading" className="min-[1100px]:sticky min-[1100px]:top-6">
        <h2 id="source-heading" className="font-serif text-[22px] font-semibold">
          Policy text
        </h2>
        <div className="sheet mt-4">
          <p className="border-b border-rule px-5 py-3 text-[13px] text-ink-2">
            Highlighted: the sentence each criterion is drawn from. Choose one to find its criterion.
          </p>
          <div ref={textPanel} className="max-h-[75dvh] overflow-y-auto px-5 py-4 font-serif text-[16px] leading-[1.75] whitespace-pre-wrap">
            {parts.map((s, i) =>
              s.criteria.length ? (
                <mark
                  key={i}
                  className="evidence"
                  data-criteria={s.criteria.join(" ")}
                  data-active={active !== null && s.criteria.includes(active)}
                  title={s.criteria.join(", ")}
                  onClick={() => select(s.criteria[0], true)}
                >
                  {s.text}
                </mark>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function Tree({
  node,
  active,
  onSelect,
  spans,
}: {
  node: PolicyNode;
  active: string | null;
  onSelect: (id: string) => void;
  spans: Record<string, [number, number] | null>;
}) {
  if (node.type === "criterion") {
    const selected = active === node.id;
    return (
      <div
        id={`criterion-${node.id}`}
        className={`-mx-2 scroll-mt-6 rounded-md px-2 py-2.5 transition-colors duration-300 ${selected ? "bg-marker/30" : ""}`}
      >
        <button type="button" onClick={() => onSelect(node.id)} aria-pressed={selected} className="text-left leading-snug hover:text-accent">
          {node.text}
        </button>
        <p className="mt-0.5 text-[13px] text-ink-2">
          <span className="code">{node.id}</span>
          {node.kind === "exclusion" && " · exclusion"}
          {!spans[node.id] && " · source sentence not found"}
        </p>
        {node.guidance && <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{node.guidance}</p>}
      </div>
    );
  }
  const op = node.op === "all" ? "All of these" : node.op === "any" ? "Any one of these" : `At least ${node.n} of these`;
  return (
    <div className="border-l border-rule pl-4">
      <p className="py-1.5 text-[13px]">
        <strong>{op}</strong> · <span className="text-ink-2">{node.label}</span>
      </p>
      <div className="divide-y divide-rule">
        {node.items.map((child, i) => (
          <Tree key={child.type === "criterion" ? child.id : `${child.label}-${i}`} node={child} active={active} onSelect={onSelect} spans={spans} />
        ))}
      </div>
    </div>
  );
}
