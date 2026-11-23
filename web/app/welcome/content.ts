import type { Finding } from "@/lib/types";

// The example on this page is the synthetic case data/cases/cms-l36575-total-knee-arthroplasty/
// tka-01-end-stage-oa.yaml and its policy, L36575. Quote positions are found in the note at run
// time, never typed in, so the example cannot drift from its own text.

export const NOTE = {
  heading: "Progress note · L. Fairbanks, MD · Oct 14, 2026",
  text:
    "74F, right knee pain for 3 years, now limiting walking to one block and making it hard to rise from a chair. Night pain.\n" +
    "Has used naproxen and acetaminophen for years, two corticosteroid injections this year (relief under 3 weeks each), cane for 6 months, and completed formal PT without lasting benefit.\n" +
    "Recommend right total knee arthroplasty.",
};

export type Example = { id: string; text: string; finding: Finding; quote: string | null; exclusion?: boolean };

export const EXAMPLES: Example[] = [
  {
    id: "pain_or_disability",
    text: "Pain or functional disability from arthritis or trauma of the knee is documented.",
    finding: "documented",
    quote: "now limiting walking to one block and making it hard to rise from a chair",
  },
  {
    id: "failed_nonsurgical_management",
    text: "Unsuccessful non-surgical management is documented.",
    finding: "documented",
    quote:
      "two corticosteroid injections this year (relief under 3 weeks each), cane for 6 months, and completed formal PT without lasting benefit",
  },
  {
    id: "active_infection",
    text: "An active infection at the knee, in the blood, teeth, skin or urinary tract is documented.",
    finding: "absent",
    quote: null,
    exclusion: true,
  },
];

export function span(quote: string | null): { start: number; end: number } | null {
  const start = quote ? NOTE.text.indexOf(quote) : -1;
  return start < 0 ? null : { start, end: start + quote!.length };
}

// Step 1: lines of the LCD L36575 text as imported (data/policies), and the criterion drawn
// from the second bullet. `quote` is the criterion's verified source_quote.
export const POLICY_SENTENCE = {
  before: "Noridian will consider total knee replacement surgery medically necessary in the following circumstances: … ",
  quote: "Pain or functional disability from injury due to trauma or arthritis of the joint",
  after: "; and",
};

export const MASKED = [
  { text: "Margaret Holloway", token: "[PATIENT]" },
  { text: " (", token: null },
  { text: "SYN-630011", token: "[MEMBER_ID]" },
  { text: ", DOB ", token: null },
  { text: "06/12/1952", token: "[DOB]" },
  { text: ") reports right knee pain for 3 years.", token: null },
];

export const INVENTED_QUOTE = "uses a walker at all times and cannot leave the house";

export const STEPS = [
  {
    title: "The policy becomes a checklist.",
    body:
      "A Local Coverage Determination is imported from the CMS Coverage API and drafted into required criteria and exclusions. Each criterion keeps the policy sentence it came from, checked word for word. A new procedure is a new policy file, not new code.",
  },
  {
    title: "Patient identifiers stay home.",
    body:
      "Name, member id and birth date are replaced before any text reaches a model. Every quote that comes back is mapped to the original note, so the nurse sees the real sentence highlighted.",
  },
  {
    title: "Every quote is found, or thrown away.",
    body:
      "The model must quote the notes for each criterion. Code then finds each quote in its note, forgiving only spacing, case, quote marks and dashes. A quote that is not there is discarded before anyone sees it.",
  },
  {
    title: "A person decides.",
    body:
      "The rules can only say meets criteria, pend or refer. A would-be approval gets a second pass that looks only for reasons against it. Denial needs a physician, and the database refuses it from anyone else.",
  },
];

export const GUARANTEES = [
  {
    title: "No invented evidence",
    body: "Quotes the model returns are located in their note by code. A quote that is not found is dropped, and an item with no quote left counts as not documented.",
    where: "indicium/review/verify.py",
  },
  {
    title: "No automatic denial",
    body: "The decision rules output meets criteria, pend or refer. Only the physician role can deny, checked by the API and again by a database constraint.",
    where: "decisions_deny_by_physician",
  },
  {
    title: "A wrong approval costs more than a referral",
    body: "Before anything is marked as meeting criteria, a narrow second pass searches for an exclusion, a different body site or a contradiction. A verified passage refers the case.",
    where: "indicium/review/engine.py",
  },
  {
    title: "Uncertainty goes to a person",
    body: "Low confidence, notes that disagree, an uncovered diagnosis and text that addresses an automated reviewer all send the case to a person, with the passage underlined.",
    where: "REFER_FLAGS in indicium/review/rules.py",
  },
  {
    title: "Identifiers never reach the model",
    body: "Name, member id and birth date are masked before text leaves the process, and spans are mapped back for highlighting.",
    where: "indicium/review/privacy.py",
  },
  {
    title: "Everything is audited",
    body: "Each review (model, prompt, policy version, input hash), each correction and each decision is written to an append-only log in the same transaction as the change.",
    where: "audit.events, append-only trigger",
  },
];

// shortcut: copied from reports/evals (runs baseline, qwen3-4b-v1, qwen3-4b-final,
// qwen2.5-1.5b-final); update together with that folder when a new run becomes the default.
export const RESULTS = {
  cases: 48,
  rows: [
    { name: "Retrieval baseline, no model", unsafe: 0, accuracy: 0.42, f1: 0.66, discarded: 0, seconds: 0.2, note: "never approves" },
    { name: "Qwen3-4B, no approval check", unsafe: 7, accuracy: 0.81, f1: 0.93, discarded: 0, seconds: 28 },
    { name: "Qwen3-4B with approval check", unsafe: 3, accuracy: 0.9, f1: 0.94, discarded: 0, seconds: 27, isDefault: true },
    { name: "Qwen2.5-1.5B with approval check", unsafe: 2, accuracy: 0.42, f1: 0.57, discarded: 0.38, seconds: 11 },
  ],
  findings: [
    "The approval check cut unsafe approvals from 7 to 3 without losing one valid approval.",
    "The 1.5B model invented 38% of its quotes. Verification discarded every one before a reviewer could see it.",
    "Three unsafe approvals remain: notes that disagree, notes about the wrong body region, and an undocumented response marked present. A nurse decides every case.",
  ],
};
