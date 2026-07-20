"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, RefreshCw, ClipboardCopy, Check } from "lucide-react";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
  title: string;
}

export default function ErrorBoundaryClient({ error, reset, title }: Props) {
  const pathname = usePathname();
  const [copied, setCopied] = useState(false);

  async function copyDiagnostics() {
    const details = [
      `route: ${pathname}`,
      `digest: ${error.digest ?? "(none)"}`,
      `error: ${error.name}: ${error.message}`,
      `time: ${new Date().toISOString()}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — surface the
      // details via prompt so they can still be copied manually.
      window.prompt("Copy diagnostic details:", details);
    }
  }

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
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-bg-elev hover:bg-bg-subtle transition-colors text-sm font-medium"
          >
            <RefreshCw className="size-4" />
            Reload
          </button>
          <button
            onClick={copyDiagnostics}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-bd hover:bg-bg-elev transition-colors text-sm font-medium text-fg-muted hover:text-fg"
          >
            {copied ? <Check className="size-4 text-ok" /> : <ClipboardCopy className="size-4" />}
            {copied ? "Copied" : "Copy diagnostic details"}
          </button>
        </div>
      </div>
    </div>
  );
}
