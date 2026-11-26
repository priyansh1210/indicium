"use client";

import { useEffect, useRef, useState } from "react";

import { Icon } from "./icons";

/** A secret or link shown once, with a button that copies it. */
export function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const shown = useRef<HTMLOutputElement>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // The clipboard needs HTTPS (or localhost). Elsewhere, select the text to copy by hand.
      window.getSelection()?.selectAllChildren(shown.current!);
    }
  }
  return (
    <div className="flex items-stretch gap-2">
      <output ref={shown} aria-label={label} className="code min-w-0 flex-1 truncate rounded-lg border border-rule bg-tint px-3 py-2 select-all">
        {value}
      </output>
      <button
        type="button"
        className="btn shrink-0"
        onClick={copy}
      >
        <Icon name="copy" />
        <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
}

/** A submit button for an action that is hard to undo: the first press asks, the second does it.
 *  It resets after a few seconds, so a stray click never lingers armed. */
export function ConfirmSubmit({
  children,
  confirm,
  pending,
  className = "btn",
}: {
  children: React.ReactNode;
  confirm: string;
  pending?: boolean;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <button
      type={armed ? "submit" : "button"}
      disabled={pending}
      onClick={() => !armed && setArmed(true)}
      className={`${className} ${armed ? "border-unmet text-unmet" : ""}`}
    >
      {armed ? confirm : children}
    </button>
  );
}
