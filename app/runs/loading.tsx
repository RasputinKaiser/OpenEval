function Bar({ className }: { className: string }) {
  return <div className={`shimmer rounded ${className}`} />;
}

export default function Loading() {
  return (
    <div className="p-8 max-w-6xl mx-auto" aria-busy="true" aria-label="Loading runs">
      <header className="mb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Bar className="mb-2 h-8 w-32" />
            <Bar className="h-4 w-56" />
          </div>
          <Bar className="h-8 w-28 rounded-md" />
        </div>
      </header>
      <div className="overflow-hidden rounded-lg border border-bd bg-bg-subtle">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-bd-subtle p-4 last:border-b-0">
            <div className="flex-1 space-y-2">
              <Bar className="h-4 w-1/3" />
              <Bar className="h-3 w-1/2" />
            </div>
            <Bar className="h-4 w-14" />
            <Bar className="h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
