function Bar({ className }: { className: string }) {
  return <div className={`shimmer rounded ${className}`} />;
}

export default function Loading() {
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto" aria-busy="true" aria-label="Loading collection">
      <header className="mb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Bar className="mb-2 h-8 w-48" />
            <Bar className="h-4 w-[28rem] max-w-full" />
          </div>
          <div className="flex items-center gap-2">
            <Bar className="h-8 w-24 rounded-md" />
            <Bar className="h-8 w-36 rounded-md" />
            <Bar className="h-8 w-24 rounded-md" />
          </div>
        </div>
      </header>

      <div className="mb-6 flex items-center gap-2 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <Bar key={i} className="h-7 w-24 rounded-md" />
        ))}
      </div>

      <section className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-bd-subtle bg-bg-subtle/30 p-3 space-y-2">
            <Bar className="h-3 w-24" />
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="flex items-center justify-between gap-2">
                <Bar className="h-3 w-24" />
                <Bar className="h-4 w-14" />
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
            <Bar className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
