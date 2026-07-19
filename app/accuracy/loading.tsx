function Bar({ className }: { className: string }) {
  return <div className={`shimmer rounded ${className}`} />;
}

export default function Loading() {
  return (
    <div className="p-8 max-w-7xl mx-auto" aria-busy="true" aria-label="Loading accuracy audit">
      <header className="mb-6">
        <Bar className="mb-2 h-8 w-56" />
        <Bar className="h-4 w-[26rem] max-w-full" />
      </header>
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-4 space-y-2">
            <Bar className="h-3 w-24" />
            <Bar className="h-7 w-14" />
            <Bar className="h-3 w-20" />
          </div>
        ))}
      </section>
      <section className="card p-3 mb-6 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
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
