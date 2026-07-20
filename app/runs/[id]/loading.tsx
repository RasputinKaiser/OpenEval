function Bar({ className }: { className: string }) {
  return <div className={`shimmer rounded ${className}`} />;
}

/** Mirrors RunDetailClient: hero band with progress card, then the
 * cases-list / case-detail two-column grid. */
export default function Loading() {
  return (
    <main className="p-4 max-w-7xl mx-auto" aria-busy="true" aria-label="Loading run detail">
      <section className="mb-4 overflow-hidden rounded-lg border border-bd">
        <div className="grid gap-4 p-4 xl:grid-cols-[1fr_360px] xl:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Bar className="h-6 w-24 rounded" />
              <Bar className="h-6 w-32 rounded" />
              <Bar className="h-6 w-20 rounded" />
            </div>
            <Bar className="mt-3 h-8 w-64" />
            <Bar className="mt-2 h-4 w-full max-w-2xl" />
          </div>
          <div className="rounded-lg border border-bd-subtle bg-bg/55 p-3">
            <div className="flex items-center justify-between">
              <Bar className="h-3 w-16" />
              <Bar className="h-3 w-10" />
            </div>
            <Bar className="mt-2 h-2 w-full rounded-full" />
            <div className="mt-3 grid grid-cols-4 gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Bar key={i} className="h-12 w-full rounded" />
              ))}
            </div>
          </div>
        </div>
      </section>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-4">
        <section className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-bd">
            <Bar className="h-4 w-24" />
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-bd-subtle p-3 last:border-b-0">
              <Bar className="size-4 rounded-full" />
              <div className="flex-1 space-y-2">
                <Bar className="h-4 w-2/3" />
                <Bar className="h-3 w-1/3" />
              </div>
              <Bar className="h-5 w-14 rounded-full" />
            </div>
          ))}
        </section>
        <section className="card p-4 space-y-4">
          <Bar className="h-6 w-48" />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Bar key={i} className="h-16 w-full rounded" />
            ))}
          </div>
          <Bar className="h-40 w-full rounded" />
        </section>
      </div>
    </main>
  );
}
