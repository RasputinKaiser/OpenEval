function Bar({ className }: { className: string }) {
  return <div className={`shimmer rounded ${className}`} />;
}

export default function Loading() {
  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto" aria-busy="true" aria-label="Loading dashboard">
      <header className="mb-6 -mx-6 md:-mx-8 -mt-6 md:-mt-8 px-6 md:px-8 py-6 border-b border-bd-subtle">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Bar className="h-8 w-48 mb-2" />
            <Bar className="h-4 w-80" />
          </div>
          <Bar className="h-10 w-full sm:w-80 rounded-lg" />
        </div>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card p-4">
            <div className="flex items-center justify-between">
              <Bar className="h-3 w-20" />
              <Bar className="size-7 rounded-md" />
            </div>
            <Bar className="h-7 w-16 mt-2" />
            <Bar className="h-3 w-24 mt-1.5" />
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <section className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <Bar className="h-4 w-56" />
            <Bar className="h-3 w-20" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Bar className="size-4" />
                <div className="flex-1 space-y-1.5">
                  <Bar className="h-4 w-1/3" />
                  <Bar className="h-3 w-1/2" />
                </div>
                <Bar className="h-4 w-14" />
              </div>
            ))}
          </div>
        </section>
        <section className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <Bar className="h-4 w-40" />
            <Bar className="h-3 w-16" />
          </div>
          <Bar className="h-11 w-full mb-3" />
          <div className="space-y-2 border-t border-bd/50 pt-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <Bar className="h-3.5 flex-1" />
                <Bar className="h-3.5 w-10" />
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <Bar className="h-4 w-32" />
            <Bar className="h-3 w-16" />
          </div>
          <div className="space-y-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-3 py-2.5 flex items-center gap-3">
                <div className="flex-1 space-y-1.5 min-w-0">
                  <Bar className="h-4 w-1/2" />
                  <Bar className="h-3 w-2/3" />
                </div>
                <Bar className="h-6 w-16 rounded-full" />
              </div>
            ))}
          </div>
        </section>
        <section className="card p-5">
          <Bar className="h-4 w-28 mb-4" />
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Bar className="h-3.5 w-28" />
                  <Bar className="h-3 w-6" />
                </div>
                <Bar className="h-1 w-full rounded-full" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
