import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center p-8">
      <div className="card p-8 max-w-md text-center">
        <FileQuestion className="size-8 text-fg-dim mx-auto mb-4" />
        <h2 className="text-lg font-semibold mb-2">Page not found</h2>
        <p className="text-sm text-fg-muted mb-6">
          Nothing lives at this address. It may have been moved or never existed.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-bg-elev hover:bg-bg-subtle transition-colors text-sm font-medium"
          >
            Dashboard
          </Link>
          <Link
            href="/runs"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-bd hover:bg-bg-elev transition-colors text-sm font-medium text-fg-muted hover:text-fg"
          >
            Browse runs
          </Link>
        </div>
      </div>
    </div>
  );
}
