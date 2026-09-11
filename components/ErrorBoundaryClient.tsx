"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, RefreshCw, ClipboardCopy, Check } from "lucide-react";
import { redactSecrets, redactSensitiveText } from "@/lib/redaction";

const CHUNK_RELOAD_KEY = "openeval.chunk-reload-attempt";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
  title: string;
}

function safeErrorMessage(value: unknown): string {
  return redactSecrets(redactSensitiveText(value));
}

export default function ErrorBoundaryClient({ error, reset, title }: Props) {
  const pathname = usePathname();
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const retryingRef = useRef(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Next's reset can reuse this client boundary for a fresh error. Clear the
    // guard so a failed retry never permanently disables recovery for the new
    // error instance.
    retryingRef.current = false;
    setRetrying(false);
    setCopied(false);
  }, [error, pathname]);

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  function retry() {
    if (retryingRef.current) return;
    retryingRef.current = true;
    setRetrying(true);
    // Chunk-load failures (deploy swapped chunk hashes while a tab held old HTML)
    // can never succeed via in-place reset — every retry re-requests the deleted
    // chunk. One hard reload picks up the new HTML + hashes; the sessionStorage
    // guard turns it into a single attempt, not a reload loop.
    if (/chunk load failed|loading chunk/i.test(error.message) && !sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
      try { sessionStorage.setItem(CHUNK_RELOAD_KEY, "1"); } catch {}
      window.location.reload();
      return;
    }
    reset();
  }

  async function copyDiagnostics() {
    const details = [
      `route: ${pathname}`,
      `digest: ${safeErrorMessage(error.digest ?? "(none)")}`,
      `error: ${safeErrorMessage(error.name)}: ${safeErrorMessage(error.message)}`,
      `time: ${new Date().toISOString()}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — surface the
      // details via prompt so they can still be copied manually.
      window.prompt("Copy diagnostic details:", details);
    }
  }

  const safeMessage = safeErrorMessage(error.message).slice(0, 500);

  return (
    <div role="alert" aria-labelledby="route-error-title" aria-describedby="route-error-message" className="min-h-[50vh] flex items-center justify-center p-4 md:p-8">
      <div className="card p-6 md:p-8 max-w-md text-center">
        <AlertTriangle aria-hidden="true" className="size-8 text-warn mx-auto mb-4" />
        <h2 id="route-error-title" className="text-lg font-semibold mb-2">{title}</h2>
        <p id="route-error-message" className="text-sm text-fg-muted mb-4 break-words">
          {safeMessage || "The page could not be loaded."}
        </p>
        {error.digest && (
          <div className="text-xs text-fg-dim mono mb-4">
            digest: {safeErrorMessage(error.digest)}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={retry}
            disabled={retrying}
            aria-busy={retrying}
            className="inline-flex items-center gap-2 rounded-lg bg-bg-elev px-4 py-2.5 text-sm font-medium transition-colors hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            {retrying ? "Retrying…" : "Retry"}
          </button>
          <button
            type="button"
            onClick={copyDiagnostics}
            className="inline-flex items-center gap-2 rounded-lg border border-bd px-4 py-2.5 text-sm font-medium text-fg-muted transition-colors hover:bg-bg-elev hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {copied ? <Check aria-hidden="true" className="size-4 text-ok" /> : <ClipboardCopy aria-hidden="true" className="size-4" />}
            {copied ? "Copied" : "Copy diagnostic details"}
          </button>
        </div>
      </div>
    </div>
  );
}
