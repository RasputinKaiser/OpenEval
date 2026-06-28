"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";

export default function ErrorBoundaryClient({
  error,
  reset,
  title,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title: string;
}) {
  const message = error.message?.slice(0, 500) ?? "Unknown error";

  return (
    <div className="p-8 max-w-2xl mx-auto flex items-center justify-center min-h-[50vh]">
      <div className="card p-8 text-center space-y-4 w-full">
        <div className="flex justify-center">
          <AlertTriangle className="size-12 text-warn" />
        </div>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-fg-muted leading-relaxed max-w-md mx-auto">
          {message}
        </p>
        {error.digest && (
          <p className="text-[11px] text-fg-dim mono bg-bg-subtle rounded px-3 py-1.5 inline-block">
            digest: {error.digest}
          </p>
        )}
        <div className="pt-2">
          <button
            onClick={() => reset()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-accent hover:bg-accent/90 text-white text-sm font-medium"
          >
            <RefreshCw className="size-4" />
            Reload
          </button>
        </div>
        <p className="text-[11px] text-fg-dim">Try again — the error may be transient.</p>
      </div>
    </div>
  );
}