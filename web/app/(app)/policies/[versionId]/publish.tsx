"use client";

import { useActionState } from "react";

import { publishVersion } from "./actions";

export function PublishButton({ versionId }: { versionId: number }) {
  const [state, action, pending] = useActionState(publishVersion.bind(null, versionId), { error: null });
  return (
    <form action={action}>
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Publishing…" : "Publish this version"}
      </button>
      {state.error && (
        <p role="alert" className="mt-1 text-[13px] text-unmet">
          {state.error}
        </p>
      )}
    </form>
  );
}
