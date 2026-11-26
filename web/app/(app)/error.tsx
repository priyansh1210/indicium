"use client";

// Production builds hide a server error's message, so the page says what to do and shows the
// reference the server logged (digest) for anyone who reports it.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="sheet mx-auto max-w-lg p-8 text-center" role="alert">
      <h1 className="title">This page could not load</h1>
      <p className="mt-2 text-ink-2">Something went wrong on our side. Try again in a moment.</p>
      {error.digest && <p className="mt-2 text-[13px] text-ink-2">Reference <span className="code">{error.digest}</span></p>}
      <button type="button" onClick={reset} className="btn btn-primary mt-5">
        Try again
      </button>
    </div>
  );
}
