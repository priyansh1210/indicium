"use client";

export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="sheet mx-auto max-w-lg p-8 text-center" role="alert">
      <h1 className="title">This page could not load</h1>
      <p className="mt-2 text-ink-2">{error.message || "Something went wrong."}</p>
      <button type="button" onClick={reset} className="btn btn-primary mt-5">
        Try again
      </button>
    </div>
  );
}
