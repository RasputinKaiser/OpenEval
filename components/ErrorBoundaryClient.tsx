"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
  title: string;
}

export default function ErrorBoundaryClient({ error, reset, title }: Props) {
  return (
    <div className="min-h-[50vh] flex items-center justify-center p-8">
      <div className="card p-8 max-w-md text-center">
        <AlertTriangle className="size-8 text-warn mx-auto mb-4" />
        <h2 className="text-lg font-semibold mb-2">{title}</h2>
        <p className="text-sm text-fg-muted mb-4">
          {error.message.slice(0, 500)}
        </p>
        {error.digest && (
          <div className="text-xs text-fg-dim mono mb-4">
            digest: {error.digest}
          </div>
        )}
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-bg-elev hover:bg-bg-subtle transition-colors text-sm font-medium"
        >
          <RefreshCw className="size-4" />
          Reload
        </button>
      </div>
    </div>
  );
}
