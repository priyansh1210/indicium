import type { Metadata } from "next";
import Link from "next/link";

import { PublicShell } from "@/components/public-shell";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <PublicShell title="Page not found" lead="The address may be mistyped, or the page has moved.">
      <Link href="/" className="btn btn-primary">
        Back to Indicium
      </Link>
    </PublicShell>
  );
}
