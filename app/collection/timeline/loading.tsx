function Bar({ className }: { className: string }) {
  return <div aria-hidden="true" className={`shimmer rounded ${className}`} />;
}

export default function Loading() {
  return (
    <div className="min-h-[calc(100vh-4rem)] p-4 md:p-6 max-w-6xl mx-auto" role="status" aria-live="polite" aria-busy="true" aria-label="Loading Timeline and Impact evidence">
      <span className="sr-only">Loading Timeline and Impact evidence…</span>
      <Bar className="h-4 w-24 mb-3" />
      <header className="mb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Bar className="mb-2 h-8 w-56" />
            <Bar className="h-4 w-[26rem] max-w-full" />
          </div>
          <div className="flex items-center gap-2">
            <Bar className="h-8 w-28 rounded-md" />
            <Bar className="h-8 w-40 rounded-md" />
          </div>
        </div>
        <div className="mt-3 grid gap-2 rounded-lg border border-bd-subtle bg-bg-subtle p-3 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Bar key={i} className="h-8 w-full" />)}
        </div>
      </header>

      <div className="mb-6 flex items-center gap-2 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <Bar key={i} className="h-7 w-24 rounded-md" />
        ))}
      </div>

      <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4" aria-label="Loading evidence overview">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-bd-subtle bg-bg-subtle p-3 space-y-2">
            <Bar className="h-3 w-20" />
            <Bar className="h-6 w-16" />
            <Bar className="h-3 w-24" />
          </div>
        ))}
      </section>

      <section className="card p-4 mb-6" aria-label="Loading adoption filters">
        <Bar className="h-4 w-32 mb-2" />
        <Bar className="h-3 w-80 max-w-full mb-3" />
        <div className="flex gap-2"><Bar className="h-7 w-16 rounded-full" /><Bar className="h-7 w-20 rounded-full" /><Bar className="h-7 w-24 rounded-full" /></div>
      </section>

      <section className="card p-5 mb-6" aria-label="Loading outcome trend">
        <Bar className="h-4 w-32 mb-4" />
        <Bar className="h-40 w-full" />
      </section>

      <section className="overflow-hidden rounded-lg border border-bd bg-bg-subtle" aria-label="Loading adoption comparisons">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-bd-subtle p-4 last:border-b-0">
            <Bar className="h-4 w-4" />
            <div className="flex-1 space-y-2">
              <Bar className="h-4 w-1/3" />
              <Bar className="h-3 w-1/2" />
            </div>
            <Bar className="h-4 w-12" />
          </div>
        ))}
      </section>
    </div>
  );
}
