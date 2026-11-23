"use client";

import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/icons";

import { EXAMPLES, INVENTED_QUOTE, MASKED, POLICY_SENTENCE, STEPS, span } from "./content";

/** "How a review works": four steps of text. On wide screens a sticky stage beside them shows the
 *  step being read; on narrow screens each step carries its own picture. The pictures repeat what
 *  the text says, so they are hidden from screen readers. */
export function Steps() {
  const [active, setActive] = useState(0);
  const [seen, setSeen] = useState(() => new Set<number>());
  // Until the observer first reports, every picture renders complete (no JavaScript, slow load).
  const [armed, setArmed] = useState(false);
  const items = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        setArmed(true);
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const n = Number((entry.target as HTMLElement).dataset.step);
          setActive(n);
          setSeen((s) => (s.has(n) ? s : new Set(s).add(n)));
        }
      },
      { rootMargin: "-40% 0px -40% 0px" },
    );
    items.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
      <ol className="lg:pt-[4vh] lg:pb-[18vh]">
        {STEPS.map((step, n) => (
          <li
            key={step.title}
            ref={(el) => {
              items.current[n] = el;
            }}
            data-step={n}
            className="py-8 lg:flex lg:min-h-[62vh] lg:flex-col lg:justify-center lg:py-0"
          >
            <p className={`code transition-colors duration-300 ${active === n ? "text-ink" : "text-ink-2"}`}>
              {String(n + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}
            </p>
            <h3
              className={`mt-3 font-serif text-[28px] leading-tight font-semibold tracking-[-0.01em] transition-colors duration-300 sm:text-[34px] ${
                active === n ? "text-ink" : "lg:text-ink-3"
              }`}
            >
              {step.title}
            </h3>
            <p className="mt-3 max-w-[46ch] text-[16px] leading-relaxed text-ink-2">{step.body}</p>
            <div aria-hidden="true" className="mt-6 lg:hidden">
              <Visual n={n} on={!armed || seen.has(n)} />
            </div>
          </li>
        ))}
      </ol>
      <div aria-hidden="true" className="hidden lg:block">
        <div className="sticky top-[14vh] grid h-[72vh] place-items-center">
          <div className="grid w-full [grid-template-areas:'stage']">
            {STEPS.map((step, n) => (
              <div
                key={step.title}
                className={`transition-[opacity,transform] duration-500 ease-(--ease-out) [grid-area:stage] ${
                  active === n ? "opacity-100" : "pointer-events-none translate-y-3 opacity-0"
                }`}
              >
                <Visual n={n} on={active === n} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Visual({ n, on }: { n: number; on: boolean }) {
  const Picture = [PolicyToChecklist, Masking, Verifying, Deciding][n];
  return (
    <div className="sheet p-6 sm:p-8" data-on={on}>
      <Picture on={on} />
    </div>
  );
}

const later = (on: boolean, ms: number) => ({ transitionDelay: on ? `${ms}ms` : "0ms" });

function PolicyToChecklist({ on }: { on: boolean }) {
  const item = EXAMPLES[0];
  return (
    <div>
      <p className="text-[12px] text-ink-2">LCD L36575 · Total Knee Arthroplasty</p>
      <p className="mt-3 font-serif text-[17px] leading-[1.7] text-ink-2">
        {POLICY_SENTENCE.before}
        <span className="stroke text-ink" data-on={on}>
          {POLICY_SENTENCE.quote}
        </span>
        {POLICY_SENTENCE.after}
      </p>
      <div
        className={`mt-6 flex items-start gap-3 rounded-lg border border-rule p-4 transition-[opacity,transform] duration-500 ease-(--ease-out) ${
          on ? "opacity-100" : "translate-y-2 opacity-0"
        }`}
        style={later(on, 450)}
      >
        <Icon name="worklist" className="mt-0.5 size-5 shrink-0 text-ink-2" />
        <div className="text-[14px]">
          <p className="text-[12px] text-ink-2">
            Criterion <span className="code">{item.id}</span> · required
          </p>
          <p className="mt-1">{item.text}</p>
        </div>
      </div>
    </div>
  );
}

// The identifiers are replaced one after another, in reading order.
const TOKEN_DELAY = MASKED.map((_, i) => MASKED.slice(0, i + 1).filter((p) => p.token).length * 260);

function Masking({ on }: { on: boolean }) {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[12px] text-ink-2">In the note</p>
        <p className="mt-1.5 font-serif text-[18px] leading-[1.8]">
          {MASKED.map((part, i) =>
            part.token ? (
              <span key={i} className="stroke" data-on={on} style={later(on, TOKEN_DELAY[i] - 200)}>
                {part.text}
              </span>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </p>
      </div>
      <div className="border-t border-rule pt-5">
        <p className="text-[12px] text-ink-2">Sent to the model</p>
        <p className="mt-1.5 font-serif text-[18px] leading-[1.8]">
          {MASKED.map((part, i) =>
            part.token ? (
              <span
                key={i}
                className={`code inline-block rounded bg-ink px-1.5 text-[12px] leading-[1.6] text-paper transition-[opacity,transform] duration-300 ${
                  on ? "opacity-100" : "translate-y-1 opacity-0"
                }`}
                style={later(on, TOKEN_DELAY[i] + 150)}
              >
                {part.token}
              </span>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </p>
      </div>
      <p className="text-[13px] text-ink-2">
        Quotes come back with <span className="code">[PATIENT]</span> in them and are mapped to the
        original characters of the note before they are highlighted.
      </p>
    </div>
  );
}

function Verifying({ on }: { on: boolean }) {
  const real = EXAMPLES[0];
  const where = span(real.quote)!;
  return (
    <div className="space-y-4">
      <p className="text-[12px] text-ink-2">Quotes returned for one criterion</p>
      <div className="rounded-lg border border-rule p-4">
        <p className="font-serif text-[16px] leading-relaxed">“{real.quote}”</p>
        <p
          className={`mt-2 flex items-center gap-1.5 text-[13px] text-met transition-opacity duration-300 ${on ? "opacity-100" : "opacity-0"}`}
          style={later(on, 350)}
        >
          <Icon name="documented" className="size-4" />
          Found in the progress note, characters {where.start}–{where.end}
        </p>
      </div>
      <div className="rounded-lg border border-rule p-4">
        <p
          className={`font-serif text-[16px] leading-relaxed text-ink-2 line-through decoration-[1.5px] transition-[text-decoration-color] duration-500 ${
            on ? "decoration-unmet" : "decoration-transparent"
          }`}
          style={later(on, 900)}
        >
          “{INVENTED_QUOTE}”
        </p>
        <p
          className={`mt-2 flex items-center gap-1.5 text-[13px] text-unmet transition-opacity duration-300 ${on ? "opacity-100" : "opacity-0"}`}
          style={later(on, 1200)}
        >
          <Icon name="contradicted" className="size-4" />
          Not in any note: discarded, never shown as evidence
        </p>
      </div>
      <p className="text-[12px] text-ink-2">The second quote is an invented example.</p>
    </div>
  );
}

const OUTCOMES = [
  { label: "Meets criteria", who: "a nurse approves" },
  { label: "Pend for information", who: "a nurse asks the provider" },
  { label: "Refer to a physician", who: "a physician reviews" },
];

function Deciding({ on }: { on: boolean }) {
  return (
    <div>
      <p className="text-[12px] text-ink-2">What the rules can say</p>
      <ul className="mt-3 space-y-2">
        {OUTCOMES.map((o, i) => (
          <li
            key={o.label}
            className={`flex items-center justify-between gap-3 rounded-lg border border-rule px-4 py-3 transition-[opacity,transform] duration-400 ease-(--ease-out) ${
              on ? "opacity-100" : "translate-x-2 opacity-0"
            }`}
            style={later(on, i * 140)}
          >
            <span className="font-semibold">{o.label}</span>
            <span className="text-[13px] text-ink-2">{o.who}</span>
          </li>
        ))}
        <li
          className={`flex items-center justify-between gap-3 rounded-lg border border-dashed border-unmet/50 bg-unmet-soft/50 px-4 py-3 transition-[opacity,transform] duration-400 ease-(--ease-out) ${
            on ? "opacity-100" : "translate-x-2 opacity-0"
          }`}
          style={later(on, 3 * 140 + 200)}
        >
          <span className="flex items-center gap-2 font-semibold text-unmet">
            <Icon name="shield" className="size-4" />
            Deny
          </span>
          <span className="text-right text-[13px] text-unmet">Physician only, enforced by the database</span>
        </li>
      </ul>
      <p className="mt-4 text-[13px] text-ink-2">
        Even with every item documented, the result is a recommendation for a person to act on.
      </p>
    </div>
  );
}
