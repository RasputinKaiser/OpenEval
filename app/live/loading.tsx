function Bar({ className }: { className: string }) {
  return <div className={`shimmer rounded ${className}`} />;
}

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6" aria-busy="true" aria-label="Loading live sessions">
      <header className="mb-6">
        <Bar className="mb-2 h-8 w-64" />
        <Bar className="h-4 w-96 max-w-full" />
      </header>
      <section className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-bd-subtle bg-bg-subtle/30 p-3 space-y-2">
            <Bar className="h-3 w-20" />
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="flex items-center justify-between gap-2">
                <Bar className="h-3 w-24" />
                <Bar className="h-4 w-12" />
              </div>
            ))}
          </div>
        ))}
      </section>
      <div className="overflow-hidden rounded-lg border border-bd bg-bg-subtle">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-bd-subtle p-4 last:border-b-0">
            <Bar className="h-4 w-4" />
            <div className="flex-1 space-y-2">
              <Bar className="h-4 w-1/3" />
              <Bar className="h-3 w-1/2" />
            </div>
            <Bar className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
