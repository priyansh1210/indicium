import { deadline, windowUsed } from "@/lib/format";

/** Time left to decide, in words, over a thin bar of the decision window already used
 *  (received to due). The bar turns amber in the last quarter and red once overdue. */
export function Deadline({ receivedAt, dueAt, closed, className = "" }: { receivedAt: string; dueAt: string; closed: boolean; className?: string }) {
  if (closed) return <span className="text-ink-2">Closed</span>;
  const due = deadline(dueAt);
  const used = windowUsed(receivedAt, dueAt);
  const tone = due.overdue ? "bg-unmet" : used >= 0.75 ? "bg-missing" : "bg-ink-2/45";
  return (
    <span className={`block ${className}`}>
      <span className={`tabular-nums ${due.overdue ? "font-semibold text-unmet" : used >= 0.75 ? "font-semibold text-missing" : ""}`}>
        {due.text}
      </span>
      <span className="mt-1.5 block h-[3px] w-full max-w-36 overflow-hidden rounded-full bg-rule" aria-hidden="true">
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${used * 100}%` }} />
      </span>
    </span>
  );
}
