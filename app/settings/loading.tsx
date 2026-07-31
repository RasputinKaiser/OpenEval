function Bar({ className }: { className: string }) {
  return <div aria-hidden="true" className={`shimmer rounded ${className}`} />;
}

export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" aria-label="Loading settings" className="mx-auto max-w-6xl px-4 py-5 sm:p-6 lg:p-8">
      <span className="sr-only">Loading settings…</span>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Bar className="mb-2 h-8 w-32" />
          <Bar className="h-4 w-80 max-w-full" />
        </div>
        <Bar className="h-8 w-24 rounded-lg" />
      </header>
      <Bar className="mb-5 h-12 w-full rounded-xl" />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <main className="space-y-5">
          {Array.from({ length: 3 }).map((_, index) => (
            <section key={index} className="card space-y-4 p-5">
              <div className="space-y-2"><Bar className="h-4 w-40" /><Bar className="h-3 w-72 max-w-full" /></div>
              <Bar className="h-11 w-full rounded-lg" />
              <Bar className="h-11 w-full rounded-lg" />
            </section>
          ))}
        </main>
        <aside className="space-y-5">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="card space-y-3 p-4"><Bar className="h-4 w-28" /><Bar className="h-10 w-full rounded-lg" /><Bar className="h-3 w-40" /></div>
          ))}
        </aside>
      </div>
    </div>
  );
}
