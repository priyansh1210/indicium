"use client";

import { useEffect, useRef, useState } from "react";

import { FindingBadge } from "@/components/badges";
import { segments } from "@/lib/marks";

import { EXAMPLES, NOTE, span } from "./content";

const MARKS = EXAMPLES.flatMap((e) => {
  const s = span(e.quote);
  return s ? [{ ...s, criterion: e.id }] : [];
});
const PARTS = segments(NOTE.text, MARKS);

/** The review screen in miniature: choose a criterion, its sentence in the note is marked. It
 *  walks through the three criteria once on arrival, and stops as soon as the visitor chooses. */
export function Specimen() {
  const [active, setActive] = useState<number | null>(null);
  const touched = useRef(false);

  useEffect(() => {
    // Under reduced motion it simply opens on the first criterion.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const steps = reduce ? [0] : [0, 1, 2, 0];
    const timers = steps.map((n, i) =>
      window.setTimeout(() => !touched.current && setActive(n), reduce ? 0 : 1100 + i * 2200),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  function choose(n: number) {
    touched.current = true;
    setActive(n);
  }

  const current = active === null ? null : EXAMPLES[active];

  return (
    <div className="sheet overflow-hidden">
      <p className="border-b border-rule px-5 py-3 text-[13px] text-ink-2">
        Total knee arthroplasty <span className="code text-ink">27447</span> · policy L36575
      </p>
      <ul className="divide-y divide-rule" aria-label="Criteria from policy L36575">
        {EXAMPLES.map((e, n) => (
          <li key={e.id}>
            <button
              type="button"
              aria-pressed={active === n}
              onClick={() => choose(n)}
              onFocus={() => choose(n)}
              className={`flex w-full items-start gap-3 px-5 py-3 text-left transition-colors duration-200 ${
                active === n ? "bg-marker/30" : "hover:bg-tint"
              }`}
            >
              <span className={`mt-0.5 h-5 w-[3px] shrink-0 rounded-full transition-colors duration-300 ${active === n ? "bg-marker-strong" : "bg-rule"}`} />
              <span className="min-w-0 flex-1 text-[14px] leading-snug">
                {e.text}
                {e.exclusion && <span className="mt-0.5 block text-[12px] text-ink-2">Exclusion</span>}
              </span>
              <FindingBadge finding={e.finding} />
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t border-rule bg-tint/60 px-5 py-4">
        <p className="text-[12px] text-ink-2">{NOTE.heading}</p>
        <p className="mt-2 font-serif text-[16px] leading-[1.7] whitespace-pre-wrap">
          {PARTS.map((s, i) =>
            s.criteria.length ? (
              <mark
                key={i}
                className="evidence"
                data-active={current !== null && s.criteria.includes(current.id)}
                onClick={() => choose(EXAMPLES.findIndex((e) => e.id === s.criteria[0]))}
              >
                {s.text}
              </mark>
            ) : (
              <span key={i}>{s.text}</span>
            ),
          )}
        </p>
        <p aria-live="polite" className="mt-3 min-h-10 text-[13px] text-ink-2">
          {current?.exclusion
            ? "No sentence shows an infection. An exclusion blocks coverage only when the notes show it."
            : current
              ? "The quote was found word for word in the note, so it is shown, highlighted."
              : " "}
        </p>
      </div>
    </div>
  );
}
