"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Icon } from "@/components/icons";
import { FormMessage } from "@/components/public-shell";

import { uploadPolicy, type UploadState } from "./actions";

/** An admin adds a policy version from a policy file. It arrives as a draft to read, then publish. */
export function PolicyUpload() {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadPolicy, { error: null });
  return (
    <details className="sheet group p-5 sm:p-6" open={Boolean(state.error)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block font-serif text-[22px] font-semibold">Add a policy version</span>
          <span className="mt-1 block text-[14px] text-ink-2">
            A new procedure is a policy file, not code: criteria, the codes they cover, and the source text each comes from.
          </span>
        </span>
        <Icon name="chevron" className="size-4 shrink-0 text-ink-2 transition-transform duration-200 group-open:rotate-90" />
      </summary>
      <form action={action} className="mt-5 flex flex-wrap items-end gap-3">
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold">Policy file (.yaml)</span>
          <input name="file" type="file" accept=".yaml,.yml,application/yaml,text/yaml" required className="block text-sm file:mr-3 file:h-9 file:cursor-pointer file:rounded-lg file:border file:border-rule file:bg-paper file:px-3 file:text-sm file:font-semibold hover:file:bg-tint" />
        </label>
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? "Checking…" : "Add as draft"}
        </button>
        <p className="basis-full text-[13px] text-ink-2">
          Every criterion must quote a sentence that is in the policy text; a file where one does not is refused. Same
          content as an existing version adds nothing.
        </p>
      </form>
      <div className="mt-3 space-y-2">
        <FormMessage error={state.error} notice={state.notice} />
        {state.versionId && (
          <Link href={`/policies/${state.versionId}`} className="btn">
            Read the draft and publish it
          </Link>
        )}
      </div>
    </details>
  );
}
