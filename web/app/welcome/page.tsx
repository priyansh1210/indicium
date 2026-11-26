import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { Icon } from "@/components/icons";
import { Wordmark } from "@/components/wordmark";
import { SESSION_COOKIE } from "@/lib/session";

import { GUARANTEES, RESULTS } from "./content";
import { Motion } from "./motion";
import { Specimen } from "./specimen";
import { INTRO, Split } from "./split";
import { Steps } from "./steps";

export const metadata: Metadata = { title: { absolute: "Indicium · prior-authorization review" } };

const SOURCE = "https://github.com/priyansh1210/indicium";

export default async function Welcome() {
  const signedIn = (await cookies()).has(SESSION_COOKIE);
  const cta = signedIn ? { href: "/", label: "Open the worklist" } : { href: "/login", label: "Sign in" };

  return (
    <div data-landing suppressHydrationWarning className="overflow-x-clip">
      <script dangerouslySetInnerHTML={{ __html: INTRO }} />
      <Motion />

      <header className="sticky top-0 z-20 border-b border-rule bg-canvas">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-8 px-4 sm:px-8">
          <Wordmark href="/welcome" />
          <nav aria-label="Sections" className="hidden items-center gap-6 text-sm font-semibold text-ink-2 md:flex">
            <a href="#how" className="hover:text-ink">How it works</a>
            <a href="#guarantees" className="hover:text-ink">Guarantees</a>
            <a href="#results" className="hover:text-ink">Results</a>
          </nav>
          <Link href={cta.href} className="btn btn-primary ml-auto">
            {cta.label}
          </Link>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-[1280px] items-center gap-12 px-4 pt-14 pb-20 sm:px-8 lg:min-h-[calc(100dvh-4rem)] lg:grid-cols-[minmax(0,11fr)_minmax(0,10fr)] lg:gap-16 lg:py-16">
          <div>
            <h1 data-hero className="display text-[clamp(46px,7vw,100px)]">
              <Split text="Every criterion points at its evidence." />
            </h1>
            <div data-hero-sub>
              <p className="mt-7 max-w-[52ch] text-[17px] leading-relaxed text-ink-2 sm:text-[18px]">
                Indicium reviews prior-authorization requests against Medicare coverage policy. For
                each criterion it quotes the sentence in the clinical notes that supports it,
                highlights it, and leaves the decision to a nurse. It never denies a request on its
                own.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
                <Link href={cta.href} className="btn btn-primary h-11 px-5 text-[15px]">
                  {cta.label}
                </Link>
                <a href="#how" className="text-[15px] font-semibold text-ink underline decoration-marker-strong decoration-2 underline-offset-[6px] hover:decoration-ink">
                  See how a review works
                </a>
              </div>
            </div>
          </div>
          <div data-hero-example>
            <Specimen />
            <p className="mt-3 text-[13px] text-ink-2">
              Choose a criterion to see the sentence behind it. Patient, note and dates are synthetic.
            </p>
          </div>
        </section>

        <section id="how" aria-labelledby="how-heading" className="scroll-mt-16 border-t border-rule">
          <div className="mx-auto max-w-[1280px] px-4 pt-20 sm:px-8 lg:pt-28">
            <h2 id="how-heading" data-split className="display max-w-[16ch] text-[clamp(36px,5vw,64px)]">
              <Split text="How a review works" />
            </h2>
            <Steps />
          </div>
        </section>

        <section id="guarantees" aria-labelledby="guarantees-heading" className="scroll-mt-16 border-t border-rule bg-paper">
          <div className="mx-auto max-w-[1280px] px-4 py-20 sm:px-8 lg:py-28">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
              <h2 id="guarantees-heading" data-split className="display text-[clamp(36px,5vw,64px)]">
                <Split text="What it guarantees, in code" />
              </h2>
              <p data-reveal className="max-w-[56ch] self-end text-[17px] leading-relaxed text-ink-2">
                A prompt can ask a model to behave. These rules do not depend on the model: each one
                is enforced by code or by the database, and each has a test that fails if it breaks.
              </p>
            </div>
            <ul className="mt-14 grid gap-x-16 md:grid-cols-2">
              {GUARANTEES.map((g) => (
                <li key={g.title} data-reveal className="border-t border-rule py-7">
                  <h3 className="font-serif text-[23px] leading-snug font-semibold">{g.title}</h3>
                  <p className="mt-2 max-w-[54ch] leading-relaxed text-ink-2">{g.body}</p>
                  <p className="mt-3 text-[13px] text-ink-2">
                    Enforced in <span className="code text-ink">{g.where}</span>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="results" aria-labelledby="results-heading" className="scroll-mt-16 border-t border-rule">
          <div className="mx-auto max-w-[1280px] px-4 py-20 sm:px-8 lg:py-28">
            <h2 id="results-heading" data-split className="display max-w-[18ch] text-[clamp(36px,5vw,64px)]">
              <Split text="How well it works" />
            </h2>
            <p data-reveal className="mt-6 max-w-[60ch] text-[17px] leading-relaxed text-ink-2">
              {RESULTS.cases} labelled synthetic cases across four policies, eight of them adversarial:
              instructions hidden in a note, notes that disagree, the wrong body region, evidence
              buried in a long record. Models ran locally on a 4 GB laptop GPU.
            </p>

            <div className="mt-12 grid gap-6 lg:grid-cols-2">
              <Chart
                title="Unsafe approvals"
                caption="Cases marked as meeting criteria that should have been pended or referred. Lower is safer."
                max={8}
                value={(r) => r.unsafe}
                format={(r) => (r.note ? `${r.unsafe}, ${r.note}` : String(r.unsafe))}
              />
              <Chart
                title="Case accuracy"
                caption="Recommendation matches the label: meets criteria, pend or refer."
                max={1}
                value={(r) => r.accuracy}
                format={(r) => `${Math.round(r.accuracy * 100)}%`}
              />
            </div>

            <ul className="mt-12 grid gap-x-10 gap-y-6 md:grid-cols-3">
              {RESULTS.findings.map((f) => (
                <li key={f} data-reveal className="border-t-2 border-ink pt-4 leading-relaxed">
                  {f}
                </li>
              ))}
            </ul>

            <details className="mt-12 text-sm">
              <summary className="cursor-pointer font-semibold">All numbers in a table</summary>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left">
                  <thead className="border-b border-rule text-ink-2">
                    <tr>
                      {["Configuration", "Criterion F1", "Case accuracy", "Unsafe approvals", "Quotes discarded", "Median time"].map((h) => (
                        <th key={h} scope="col" className="py-2 pr-4 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {RESULTS.rows.map((r) => (
                      <tr key={r.name} className={`border-b border-rule ${r.isDefault ? "font-semibold" : ""}`}>
                        <th scope="row" className={`py-2 pr-4 ${r.isDefault ? "font-semibold" : "font-normal"}`}>
                          {r.name}
                          {r.isDefault && " (default)"}
                        </th>
                        <td className="py-2 pr-4">{r.f1.toFixed(2)}</td>
                        <td className="py-2 pr-4">{Math.round(r.accuracy * 100)}%</td>
                        <td className="py-2 pr-4">{r.unsafe}</td>
                        <td className="py-2 pr-4">{Math.round(r.discarded * 100)}%</td>
                        <td className="py-2 pr-4">{r.seconds} s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <a href={`${SOURCE}/tree/main/reports/evals`} className="mt-3 inline-flex items-center gap-1 font-semibold text-accent hover:underline">
                Every run and every case result
                <Icon name="external" className="size-3.5" />
              </a>
            </details>
          </div>
        </section>

        <section aria-labelledby="try-heading" className="border-t border-rule bg-ink text-paper dark:bg-tint dark:text-ink">
          <div className="mx-auto flex max-w-[1280px] flex-col items-start gap-8 px-4 py-20 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:py-28">
            <h2 id="try-heading" data-split className="display max-w-[18ch] text-[clamp(36px,5vw,64px)]">
              <Split text="Open a case and check the evidence yourself." />
            </h2>
            <div data-reveal className="max-w-sm">
              <p className="text-paper/75 dark:text-ink-2">
                Sample accounts on the sign-in page open each side: a nurse, a physician, a supervisor, an
                admin, or a practice sending requests. Every patient is synthetic.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
                <Link href={cta.href} className="btn h-11 border-marker-strong bg-marker-strong px-5 text-[15px] text-ink hover:border-marker hover:bg-marker">
                  {cta.label}
                </Link>
                {!signedIn && (
                  <Link href="/register" className="text-[15px] font-semibold text-paper underline decoration-marker-strong decoration-2 underline-offset-[6px] hover:decoration-paper dark:text-ink dark:hover:decoration-ink">
                    Register a practice
                  </Link>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-[1280px] flex-col gap-4 px-4 py-10 text-[13px] text-ink-2 sm:px-8 md:flex-row md:items-start md:justify-between">
        <Wordmark href="/welcome" />
        <p className="max-w-[70ch]">
          Synthetic patients and notes only. Coverage policies come from the public CMS Medicare
          Coverage Database. Icons: Solar by 480 Design, CC BY 4.0.
        </p>
        <a href={SOURCE} className="inline-flex items-center gap-1 font-semibold text-ink hover:underline">
          Source on GitHub
          <Icon name="external" className="size-3.5" />
        </a>
      </footer>
    </div>
  );
}

type Row = (typeof RESULTS.rows)[number];

function Chart({
  title,
  caption,
  max,
  value,
  format,
}: {
  title: string;
  caption: string;
  max: number;
  value: (r: Row) => number;
  format: (r: Row) => string;
}) {
  return (
    <figure data-chart className="sheet p-6 sm:p-7">
      <figcaption>
        <span className="heading block">{title}</span>
        <span className="mt-1 block text-[13px] text-ink-2">{caption}</span>
      </figcaption>
      <ul className="mt-6 space-y-4">
        {RESULTS.rows.map((r) => {
          const detail = `${r.name}: ${format(r)}. Criterion F1 ${r.f1.toFixed(2)}, ${Math.round(r.discarded * 100)}% of quotes discarded, median ${r.seconds} s per case.`;
          return (
            <li key={r.name} className="grid gap-1.5 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:items-center sm:gap-4">
              <span className={`text-[13px] leading-tight ${r.isDefault ? "font-semibold" : "text-ink-2"}`}>
                {r.name}
                {r.isDefault && <span className="font-normal text-ink-2"> · default</span>}
              </span>
              <div tabIndex={0} aria-label={detail} className="group relative flex h-6 items-center border-l border-ink-2/60 outline-offset-4">
                <div
                  data-bar
                  className="h-4 rounded-r-[4px]"
                  style={{
                    width: `${(value(r) / max) * 100}%`,
                    background: r.isDefault ? "var(--color-chart)" : "var(--color-chart-muted)",
                  }}
                />
                <span className="ml-2 shrink-0 text-[13px] tabular-nums">{format(r)}</span>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-full left-0 z-10 mb-2 w-max max-w-[18rem] rounded-md bg-ink px-3 py-2 text-[12px] leading-snug text-paper opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                >
                  {detail}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
