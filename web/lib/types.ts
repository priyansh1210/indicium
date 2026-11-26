// Shapes of the API's responses that the screens use. Kept by hand next to indicium/api.
// shortcut: hand-kept types can drift from the API; generate from /openapi.json if they grow.

export type Role = "viewer" | "nurse" | "physician" | "supervisor" | "admin";
export type Finding = "documented" | "contradicted" | "absent" | "conflicting";
export type Recommendation = "meets_criteria" | "pend_for_info" | "refer_to_clinician";
export type CaseStatus =
  | "received"
  | "queued"
  | "in_review"
  | "awaiting_nurse"
  | "failed"
  | "pended"
  | "referred"
  | "approved"
  | "denied";

export type Principal = { kind: string; user_id: number | null; email: string; name: string; role: Role };

export type WorklistRow = {
  case_id: number;
  external_id: string;
  patient_name: string;
  procedure_code: string;
  urgency: "standard" | "expedited";
  status: CaseStatus;
  requested_by: string;
  received_at: string;
  due_at: string;
  overdue: boolean;
  run_id: number | null;
  recommendation: Recommendation | null;
  flags: string[] | null;
  policy_title: string | null;
};

export type Evidence = { doc_id: string; quote: string; start: number; end: number };

export type CriterionItem = {
  type: "criterion";
  id: string;
  kind: "required" | "exclusion";
  text: string;
  guidance: string;
  source_quote: string;
  finding: Finding | null;
  confidence: number | null;
  rationale: string | null;
  evidence: Evidence[];
  dropped: { doc_id: string; quote: string; reason: string }[];
  override: { finding: Finding; reason: string; at: string; by_name: string } | null;
  effective: Finding | null;
};

export type GroupItem = {
  type: "group";
  op: "all" | "any" | "at_least";
  n: number | null;
  label: string;
  items: ChecklistNode[];
};

export type ChecklistNode = CriterionItem | GroupItem;

export type CaseDetail = {
  case: {
    case_id: number;
    external_id: string;
    patient: { member_id: string; name: string; birth_date: string; sex: string };
    procedure_code: string;
    diagnosis_codes: string[];
    urgency: "standard" | "expedited";
    requested_by: string;
    status: CaseStatus;
    received_at: string;
    due_at: string;
  };
  documents: { doc_id: string; kind: string; author: string; written_on: string | null; text: string }[];
  policy: { policy_id: string; title: string; source: { document_id: string; url: string | null } } | null;
  checklist: GroupItem | null;
  review: {
    run_id: number;
    recommendation: Recommendation;
    reasons: string[];
    model_recommendation: Recommendation;
    flags: string[];
    injection_hits: { doc_id: string; start: number; end: number; text: string }[];
    concerns: {
      kind: "exclusion" | "scope" | "contradiction";
      criterion_id: string;
      doc_id: string;
      quote: string;
      start: number;
      end: number;
      explanation: string;
    }[];
    provider: string | null;
    model: string | null;
    prompt_version: string | null;
    finished_at: string;
  } | null;
  runs: { run_id: number; status: string; attempts: number; error: string | null }[];
  decisions: {
    decision_id: number;
    outcome: string;
    reason: string;
    recommendation: Recommendation | null;
    against_recommendation: boolean;
    role: Role;
    at: string;
    by_name: string;
  }[];
};

export type AuditEvent = {
  event_id: number;
  at: string;
  actor: string;
  action: string;
  target_type: string;
  target_id: string;
  detail: Record<string, unknown>;
};
