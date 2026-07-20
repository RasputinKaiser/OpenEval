function Bar({ className }: { className: string }) {
  return <div className={`shimmer rounded ${className}`} />;
}

/** Mirrors the session transcript viewer: back link, file header, then a
 * column of turn cards. */
export default function Loading() {
  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto" aria-busy="true" aria-label="Loading session transcript">
      <Bar className="mb-2 h-3 w-20" />
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <Bar className="size-9 rounded-lg" />
          <div className="space-y-2">
            <Bar className="h-6 w-64" />
            <Bar className="h-3 w-96 max-w-full" />
          </div>
        </div>
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="card p-3">
            <div className="flex items-center gap-2 mb-2">
              <Bar className="size-4 rounded-full" />
              <Bar className="h-3 w-20" />
              <Bar className="ml-auto h-3 w-14" />
            </div>
            <Bar className="h-4 w-full" />
            <Bar className="mt-2 h-4 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}
