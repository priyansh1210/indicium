"use client";

import { useActionState } from "react";

import type { CaseDetail, Principal } from "@/lib/types";

import { assignCase, type FormState } from "./actions";

export type Reviewer = { user_id: number; name: string; role: string; open_cases: number; due_soon: number };

/** Who is working the case. A reviewer takes or releases it; a supervisor hands it to anyone,
 *  seeing how many open cases each person already holds. */
export function Assignment({
  detail,
  me,
  reviewers,
}: {
  detail: CaseDetail;
  me: Principal;
  reviewers: Reviewer[] | null;
}) {
  const caseId = detail.case.case_id;
  const assignee = detail.assignee;
  const [state, act, pending] = useActionState<FormState, FormData>(
    (_: FormState, form: FormData) => assignCase(caseId, form.get("user_id") ? Number(form.get("user_id")) : null),
    { error: null },
  );
  const closed = detail.case.status === "approved" || detail.case.status === "denied";
  const physiciansOnly = detail.case.status === "referred"; // a referred case goes to a physician
  const canTake = me.role === "physician" || (me.role === "nurse" && !physiciansOnly);

  return (
    <div className="text-sm">
      <p className={reviewers ? "sr-only" : "text-ink-2"}>
        {assignee ? (
          <>
            Assigned to <span className="font-semibold text-ink">{assignee.user_id === me.user_id ? "you" : assignee.name}</span>
          </>
        ) : closed ? null : (
          "Unassigned"
        )}
      </p>
      {!closed && reviewers && (
        <form action={act} className="flex items-center gap-2 sm:justify-end">
          <label htmlFor="assignee" className="text-ink-2">
            Assigned to
          </label>
          <select
            id="assignee"
            name="user_id"
            defaultValue={assignee?.user_id ?? ""}
            disabled={pending}
            onChange={(e) => e.currentTarget.form!.requestSubmit()}
            className="field h-8 w-auto max-w-60 py-0 text-[13px]"
          >
            <option value="">Nobody</option>
            {reviewers
              .filter((r) => !physiciansOnly || r.role === "physician")
              .map((r) => (
                <option key={r.user_id} value={r.user_id}>
                  {r.name} ({r.role}), {r.open_cases} open
                </option>
              ))}
          </select>
        </form>
      )}
      {!closed && !reviewers && canTake && (!assignee || assignee.user_id === me.user_id) && (
        <form action={act} className="mt-1.5">
          <input type="hidden" name="user_id" value={assignee ? "" : String(me.user_id)} />
          <button type="submit" disabled={pending} className="btn h-8 px-2.5 text-[13px]">
            {pending ? "Saving…" : assignee ? "Release" : "Take this case"}
          </button>
        </form>
      )}
      {state.error && (
        <p role="alert" className="mt-1 text-[13px] text-unmet">
          {state.error}
        </p>
      )}
    </div>
  );
}
