import type { CaseStatus, Finding, Recommendation } from "./types";

export const FINDING_LABEL: Record<Finding, string> = {
  documented: "Documented",
  contradicted: "Contradicted",
  absent: "Not documented",
  conflicting: "Notes disagree",
};

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  meets_criteria: "Meets criteria",
  pend_for_info: "Pend for information",
  refer_to_clinician: "Refer to a physician",
};

export const STATUS_LABEL: Record<CaseStatus, string> = {
  received: "Received",
  queued: "Waiting for review",
  in_review: "Being reviewed",
  awaiting_nurse: "Ready for nurse",
  failed: "Review failed",
  pended: "Pended",
  referred: "With physician",
  approved: "Approved",
  denied: "Denied",
};

export const FLAG_LABEL: Record<string, string> = {
  possible_injection: "Text in the notes addresses an automated reviewer",
  diagnosis_not_covered: "Diagnosis code not on the policy's list",
  conflicting_evidence: "Notes disagree on an item",
  low_confidence: "Low confidence on an item",
  extraction_failed: "Notes could not be read automatically",
};

/** "due in 2 d 4 h" or "overdue by 3 h", relative to now. */
export function deadline(dueAt: string, now = Date.now()): { text: string; overdue: boolean } {
  const minutes = Math.round((new Date(dueAt).getTime() - now) / 60_000);
  const span = Math.abs(minutes);
  const days = Math.floor(span / 1440);
  const hours = Math.floor((span % 1440) / 60);
  const parts = days ? `${days} d ${hours} h` : hours ? `${hours} h` : `${span % 60} min`;
  return minutes < 0 ? { text: `overdue by ${parts}`, overdue: true } : { text: `due in ${parts}`, overdue: false };
}

export function day(iso: string | null): string {
  if (!iso) return "undated";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function moment(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function humanize(text: string): string {
  return text.replaceAll("_", " ");
}
