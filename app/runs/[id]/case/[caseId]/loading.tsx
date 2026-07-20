function Bar({ className }: { className: string }) {
  return <div className={`shimmer rounded ${className}`} />;
}

/** Mirrors CaseDetailClient: back link, title block, stat grid, then
 * collapsible tool-call / transcript section cards. */
export default function Loading() {
  return (
    <main className="p-8 max-w-5xl mx-auto space-y-4" aria-busy="true" aria-label="Loading case detail">
      <div>
        <Bar className="h-3 w-24" />
        <Bar className="mt-2 h-7 w-72" />
        <Bar className="mt-2 h-3 w-48" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card p-3 space-y-2">
            <Bar className="h-3 w-16" />
            <Bar className="h-4 w-20" />
          </div>
        ))}
      </div>
      {/* Three placeholders: tool calls, transcript, and (for visual-code
          cases) the visual preview — an extra card collapsing away is less
          jarring than a third section popping in. */}
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="card overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-bd-subtle">
            <Bar className="size-4" />
            <Bar className="h-4 w-28" />
          </div>
          <div className="p-4 space-y-3">
            <Bar className="h-4 w-full" />
            <Bar className="h-4 w-5/6" />
            <Bar className="h-4 w-2/3" />
          </div>
        </div>
      ))}
    </main>
  );
}
