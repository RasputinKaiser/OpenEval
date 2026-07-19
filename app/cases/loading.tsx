function Bar({ className }: { className: string }) {
  return <div className={`shimmer rounded ${className}`} />;
}

export default function Loading() {
  return (
    <div className="p-8 max-w-7xl mx-auto" aria-busy="true" aria-label="Loading cases">
      <header className="mb-6">
        <Bar className="mb-2 h-8 w-32" />
        <Bar className="h-4 w-72" />
      </header>
      <div className="flex flex-wrap gap-2 mb-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <Bar key={i} className="h-7 w-24 rounded-md" />
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="card p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <Bar className="h-4 w-2/3" />
              <Bar className="h-5 w-16 rounded-full" />
            </div>
            <Bar className="h-3 w-full" />
            <Bar className="h-3 w-3/4" />
            <div className="flex gap-1.5 pt-1">
              <Bar className="h-4 w-12 rounded" />
              <Bar className="h-4 w-14 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
