import Link from "next/link";

/** The name, underlined by the product's highlighter stroke. */
export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="font-serif text-xl font-semibold tracking-[-0.01em]">
      <span className="stroke stroke-under" data-on="true">
        Indicium
      </span>
    </Link>
  );
}
