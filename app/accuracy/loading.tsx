function Bar({ className }: { className: string }) {
  return <div aria-hidden="true" className={`shimmer rounded ${className}`} />;
}

export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" aria-label="Loading accuracy audit" className="min-h-[calc(100vh-4rem)] p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <span className="sr-only">Loading accuracy audit…</span>
      <header className="mb-6">
        <Bar className="mb-2 h-8 w-56" />
        <Bar className="h-4 w-[26rem] max-w-full" />
      </header>
      <Bar className="mb-5 h-10 w-full rounded-lg" />
      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card p-4 space-y-2">
            <Bar className="h-3 w-24" />
            <Bar className="h-7 w-14" />
            <Bar className="h-3 w-20" />
          </div>
        ))}
      </section>
      <section className="mb-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-bd-subtle bg-bg-subtle p-3.5 space-y-2">
            <Bar className="h-4 w-28" />
            <Bar className="h-6 w-16" />
            <Bar className="h-3 w-full" />
          </div>
        ))}
      </section>
      <section className="card p-3 mb-5 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Bar key={i} className="h-7 w-20 rounded-md" />
          ))}
        </div>
        <Bar className="h-8 w-full sm:w-56 rounded-md" />
      </section>
      <div className="overflow-hidden rounded-lg border border-bd bg-bg-subtle">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-bd-subtle p-4 last:border-b-0">
            <Bar className="h-4 w-4" />
            <div className="flex-1 space-y-2">
              <Bar className="h-4 w-1/4" />
              <Bar className="h-3 w-1/2" />
            </div>
            <Bar className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
