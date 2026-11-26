"use client";

import { useEffect, useRef, useState } from "react";

// Charts in one hue (--color-chart, validated with the dataviz palette script; see DESIGN.md).
// Thin marks, a square baseline, 4px rounded data ends, hairline grid, labels in text colours.

export type Day = { day: string; total: number; parts: { label: string; n: number }[] };

/** A column of a given height whose top corners are rounded and whose foot is square. */
function column(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Ticks at clean steps from zero to at least the maximum. */
function ticks(max: number): number[] {
  if (max <= 4) return Array.from({ length: Math.max(max, 1) + 1 }, (_, i) => i);
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500].find((s) => max / s <= 4) ?? Math.ceil(max / 4);
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step);
}

const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** One column per day; hover or focus a day for its breakdown. The table below holds every value. */
export function DailyColumns({ days, label }: { days: Day[]; label: string }) {
  const [active, setActive] = useState<number | null>(null);
  // Drawn at the width it is shown at, so text keeps its size on a phone instead of shrinking.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setW(Math.max(entry.contentRect.width, 240)));
    observer.observe(box.current!);
    return () => observer.disconnect();
  }, []);
  const H = 200;
  const pad = { top: 12, right: 8, bottom: 28, left: 32 };
  const axis = ticks(Math.max(...days.map((d) => d.total), 0));
  const top = axis.at(-1)!;
  const band = (W - pad.left - pad.right) / days.length;
  const bar = Math.min(24, band * 0.6);
  const y = (v: number) => pad.top + (H - pad.top - pad.bottom) * (1 - v / top);
  const shown = active === null ? null : days[active];
  const labelled = new Set([0, Math.floor((days.length - 1) / 2), days.length - 1]);

  return (
    <div ref={box} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
        {axis.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} className="stroke-rule" strokeWidth={1} />
            <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-ink-2 text-[11px] tabular-nums">
              {t}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = pad.left + band * i + (band - bar) / 2;
          return (
            <g key={d.day}>
              {d.total > 0 && (
                <path
                  d={column(x, y(d.total), bar, y(0) - y(d.total))}
                  className={active === null || active === i ? "fill-chart" : "fill-chart-muted"}
                />
              )}
              {labelled.has(i) && (
                // The first and last dates align to the chart's edges so neither is cut off.
                <text
                  x={i === 0 ? pad.left : i === days.length - 1 ? W - pad.right : pad.left + band * i + band / 2}
                  y={H - 8}
                  textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"}
                  className="fill-ink-2 text-[11px]"
                >
                  {shortDay(d.day)}
                </text>
              )}
              {/* The whole band is the target, not just the painted column. */}
              <rect
                x={pad.left + band * i}
                y={pad.top}
                width={band}
                height={H - pad.top - pad.bottom}
                fill="transparent"
                tabIndex={0}
                aria-label={`${shortDay(d.day)}: ${d.total} decisions`}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="outline-none focus-visible:fill-accent-soft/60"
              />
            </g>
          );
        })}
      </svg>
      {shown && (
        <div
          role="status"
          className="pointer-events-none absolute top-0 z-10 w-44 rounded-lg border border-rule bg-paper px-3 py-2 text-[13px] shadow-[0_6px_18px_rgb(29_28_26/0.08)]"
          style={{
            left: `clamp(0px, calc(${((pad.left + band * active! + band / 2) / W) * 100}% - 88px), calc(100% - 176px))`,
          }}
        >
          <p className="text-ink-2">{shortDay(shown.day)}</p>
          <p className="text-[15px] font-semibold tabular-nums">
            {shown.total} {shown.total === 1 ? "decision" : "decisions"}
          </p>
          {shown.parts
            .filter((p) => p.n > 0)
            .map((p) => (
              <p key={p.label} className="flex justify-between gap-3">
                <span className="text-ink-2">{p.label}</span>
                <span className="font-semibold tabular-nums">{p.n}</span>
              </p>
            ))}
        </div>
      )}
    </div>
  );
}

/** A name, a bar and a figure per row, bars on one baseline. For counts against a shared maximum. */
export function MeterList({ rows, unit }: { rows: { label: string; n: number; note?: string }[]; unit: string }) {
  const max = Math.max(...rows.map((r) => r.n), 1);
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[9.5rem_minmax(0,1fr)_3rem] items-center gap-3 text-sm max-sm:grid-cols-[minmax(0,1fr)_3rem]">
          <span className="truncate">
            {r.label}
            {r.note && <span className="ml-1.5 text-[12px] text-ink-2">{r.note}</span>}
          </span>
          <span className="h-3 rounded-r-[4px] bg-chart/15 max-sm:col-span-2 max-sm:row-start-2" aria-hidden="true">
            {r.n > 0 && <span className="block h-full rounded-r-[4px] bg-chart" style={{ width: `${(r.n / max) * 100}%` }} />}
          </span>
          <span className="text-right font-semibold tabular-nums max-sm:row-start-1 max-sm:col-start-2" aria-label={`${r.n} ${unit}`}>
            {r.n}
          </span>
        </li>
      ))}
    </ul>
  );
}
