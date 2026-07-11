/**
 * Instant route-transition placeholder rendered by Next's `loading.tsx` while
 * a server component scans/aggregates. Mirrors the shared page anatomy
 * (PageHeader → stat cards → table) so the swap to real content is calm.
 */
export default function RouteSkeleton({ stats = 4, rows = 8 }: { stats?: number; rows?: number }) {
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto" aria-busy="true" aria-label="Loading">
      <header className="mb-5">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-lg shimmer" />
          <div className="h-6 w-44 shimmer rounded" />
        </div>
        <div className="h-4 w-80 max-w-full shimmer rounded mt-2" />
      </header>
      {stats > 0 && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {Array.from({ length: stats }).map((_, i) => (
            <div key={i} className="card p-3 space-y-2">
              <div className="h-2.5 w-20 shimmer rounded" />
              <div className="h-6 w-16 shimmer rounded" />
            </div>
          ))}
        </section>
      )}
      <section className="card overflow-hidden">
        <div className="px-3 py-2.5 border-b border-bd">
          <div className="h-3 w-32 shimmer rounded" />
        </div>
        <div className="p-3 space-y-3">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="h-3.5 shimmer rounded" style={{ width: `${28 + ((i * 17) % 30)}%` }} />
              <div className="h-3.5 w-14 shimmer rounded ml-auto" />
              <div className="h-3.5 w-10 shimmer rounded" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
