// Shown while any signed-in screen loads (one boundary: navigation meets this one first).
// The top bar stays; the shapes echo a title and a list.
export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="space-y-6">
      <div className="skeleton h-9 w-56" />
      <div className="sheet divide-y divide-rule">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-6 px-5 py-4">
            <div className="skeleton h-4 w-40" />
            <div className="skeleton h-4 flex-1 max-sm:hidden" />
            <div className="skeleton h-4 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
