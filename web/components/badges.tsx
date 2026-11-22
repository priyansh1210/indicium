import { FINDING_LABEL, RECOMMENDATION_LABEL } from "@/lib/format";
import type { Finding, Recommendation } from "@/lib/types";

import { Icon } from "./icons";

const FINDING_STYLE: Record<Finding, string> = {
  documented: "bg-met-soft text-met",
  contradicted: "bg-unmet-soft text-unmet",
  absent: "bg-missing-soft text-missing",
  conflicting: "bg-conflict-soft text-conflict",
};

/** A finding as a word with its colour and icon; never colour alone. */
export function FindingBadge({ finding }: { finding: Finding | null }) {
  if (!finding) return <span className="text-[13px] text-ink-2">Not reviewed</span>;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[13px] font-semibold ${FINDING_STYLE[finding]}`}
    >
      <Icon name={finding} className="size-3.5" />
      {FINDING_LABEL[finding]}
    </span>
  );
}

const RECOMMENDATION_STYLE: Record<Recommendation, string> = {
  meets_criteria: "text-met",
  pend_for_info: "text-missing",
  refer_to_clinician: "text-unmet",
};

export function RecommendationText({ value }: { value: Recommendation | null }) {
  if (!value) return <span className="text-ink-2">Not reviewed yet</span>;
  return <span className={`font-semibold ${RECOMMENDATION_STYLE[value]}`}>{RECOMMENDATION_LABEL[value]}</span>;
}
