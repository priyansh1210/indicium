import Link from "next/link";

export default function CaseNotFound() {
  return (
    <div className="sheet mx-auto max-w-lg p-8 text-center">
      <h1 className="title">No such case</h1>
      <p className="mt-2 text-ink-2">It may have been mistyped, or it was never submitted.</p>
      <Link href="/" className="btn mt-5">
        Back to the worklist
      </Link>
    </div>
  );
}
