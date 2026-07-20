import Link from "next/link";
import { SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center p-8">
      <div className="card p-8 max-w-md text-center">
        <SearchX className="size-8 text-fg-dim mx-auto mb-4" />
        <h2 className="text-lg font-semibold mb-2">Case not found</h2>
        <p className="text-sm text-fg-muted mb-6">
          This run has no case with that id. The case may belong to a different run, or the id was mistyped.
        </p>
        <Link
          href="/runs"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-bg-elev hover:bg-bg-subtle transition-colors text-sm font-medium"
        >
          Back to all runs
        </Link>
      </div>
    </div>
  );
}
