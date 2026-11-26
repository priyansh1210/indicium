"use client";

import { useId, useState } from "react";

import { Icon } from "@/components/icons";

const KINDS = [
  ["progress_note", "Progress note"],
  ["imaging_report", "Imaging report"],
  ["therapy_note", "Therapy note"],
  ["sleep_study", "Sleep study"],
  ["referral", "Referral"],
  ["operative_note", "Operative note"],
  ["other", "Other"],
] as const;

type Draft = { key: number; text: string };

/** One or more clinical documents: pasted text, or a .txt file read in the browser. Field names
 *  repeat (doc_kind, doc_date, doc_author, doc_text) and are read in order by the action. */
export function DocumentFields({ first = "progress_note" }: { first?: string }) {
  const [drafts, setDrafts] = useState<Draft[]>([{ key: 0, text: "" }]);
  const base = useId();

  const set = (key: number, text: string) => setDrafts((all) => all.map((d) => (d.key === key ? { ...d, text } : d)));

  async function load(key: number, file: File | undefined) {
    if (file) set(key, await file.text());
  }

  return (
    <div className="space-y-5">
      {drafts.map((draft, i) => (
        <fieldset key={draft.key} className="space-y-3 border-t border-rule pt-5 first:border-0 first:pt-0">
          <legend className="sr-only">Document {i + 1}</legend>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_minmax(0,1fr)]">
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold">Document {i + 1}</span>
              <select name="doc_kind" defaultValue={i === 0 ? first : "other"} className="field h-[43px]">
                {KINDS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold">Written on</span>
              <input name="doc_date" type="date" className="field" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold">Author</span>
              <input name="doc_author" maxLength={200} placeholder="e.g. Dana Ruiz, PT" className="field" />
            </label>
          </div>
          <label className="block space-y-1.5" htmlFor={`${base}-text-${draft.key}`}>
            <span className="text-sm font-semibold">Text</span>
          </label>
          <textarea
            id={`${base}-text-${draft.key}`}
            name="doc_text"
            rows={8}
            maxLength={200_000}
            value={draft.text}
            onChange={(e) => set(draft.key, e.target.value)}
            placeholder="Paste the note as written in the chart."
            className="field font-serif text-[16px] leading-relaxed"
          />
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="btn h-8 cursor-pointer px-2.5 text-[13px]">
              <Icon name="upload" className="size-3.5" />
              Load from a text file
              <input type="file" accept=".txt,text/plain" className="sr-only" onChange={(e) => load(draft.key, e.target.files?.[0])} />
            </label>
            {drafts.length > 1 && (
              <button
                type="button"
                onClick={() => setDrafts((all) => all.filter((d) => d.key !== draft.key))}
                className="font-semibold text-ink-2 hover:text-unmet"
              >
                Remove this document
              </button>
            )}
            <span className="ml-auto text-[13px] text-ink-2 tabular-nums">{draft.text.length.toLocaleString()} characters</span>
          </div>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={() => setDrafts((all) => [...all, { key: Math.max(...all.map((d) => d.key)) + 1, text: "" }])}
        className="btn"
      >
        <Icon name="plus" />
        Add another document
      </button>
    </div>
  );
}
