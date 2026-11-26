import Link from "next/link";

import { Wordmark } from "./wordmark";

/** The frame of the pages people see before signing in: sign-in, password links, registration. */
export function PublicShell({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-16 w-full max-w-[1120px] items-center justify-between px-4 sm:px-8">
        <Wordmark href="/welcome" />
        <Link href="/welcome" className="text-sm font-semibold text-ink-2 hover:text-ink">
          What is Indicium?
        </Link>
      </header>
      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 pt-8 pb-16 sm:px-8 lg:pt-16">
        <h1 className="display rise text-[clamp(40px,5.5vw,68px)]">{title}</h1>
        {lead && (
          <p className="rise mt-4 max-w-[56ch] text-[17px] leading-relaxed text-ink-2" style={{ "--i": 1 } as React.CSSProperties}>
            {lead}
          </p>
        )}
        <div className="mt-10">{children}</div>
      </main>
    </div>
  );
}

/** A form's outcome: an error in red, or a confirmation in green. */
export function FormMessage({ error, notice }: { error?: string | null; notice?: string | null }) {
  if (error)
    return (
      <p role="alert" className="rounded-lg bg-unmet-soft px-3 py-2 text-sm text-unmet">
        {error}
      </p>
    );
  if (notice)
    return (
      <p role="status" className="rounded-lg bg-met-soft px-3 py-2 text-sm text-met">
        {notice}
      </p>
    );
  return null;
}
