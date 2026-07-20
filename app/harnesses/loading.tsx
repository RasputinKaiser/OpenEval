function Bar({ className }: { className: string }) {
  return <div className={`shimmer rounded ${className}`} />;
}

/** Mirrors HarnessesClient: page header with re-probe action, then the
 * harness-list sidebar / detail-card two-column grid. */
export default function Loading() {
  return (
    <div className="p-8 max-w-6xl mx-auto" aria-busy="true" aria-label="Loading harnesses">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Bar className="mb-2 h-8 w-40" />
          <Bar className="h-4 w-72" />
        </div>
        <Bar className="h-8 w-32 rounded-md" />
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        <div className="space-y-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-3 py-2.5 rounded-md border border-bd space-y-2">
              <div className="flex items-center gap-2">
                <Bar className="size-3.5 rounded-full" />
                <Bar className="h-4 w-24" />
              </div>
              <Bar className="h-3 w-32" />
            </div>
          ))}
        </div>
        <div className="card p-5 space-y-4">
          <Bar className="h-6 w-40" />
          <Bar className="h-3 w-32" />
          <div className="mt-4 grid grid-cols-2 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Bar className="h-3 w-16" />
                <Bar className="h-4 w-24" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
