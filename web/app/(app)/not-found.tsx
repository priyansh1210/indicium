import Link from "next/link";

export default function NotFound() {
  return (
    <div className="sheet mx-auto max-w-lg p-8 text-center">
      <h1 className="title">Page not found</h1>
      <p className="mt-2 text-ink-2">The address may be mistyped, or this page is not open to your role.</p>
      <Link href="/" className="btn mt-5">
        Back to Indicium
      </Link>
    </div>
  );
}
