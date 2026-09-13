"use client";

import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, RefreshCw } from "lucide-react";
import packageInfo from "@/package.json";
import { RELEASES_URL } from "@/lib/releases";

const { version } = packageInfo;

type Release = { installed: string; latest: string; available: boolean; url: string };

export default function UpdatePanel() {
  const [release, setRelease] = useState<Release | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function check() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/updates", { signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not check for updates.");
      setRelease(result);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not check for updates.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return <section aria-labelledby="updates-title" className="mb-6 rounded-xl border border-bd bg-surface p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 id="updates-title" className="flex items-center gap-2 text-base font-semibold"><Download aria-hidden="true" className="size-4 text-accent" /> OpenEval updates</h2>
        <p className="mt-1 text-sm text-muted">Installed version <span className="font-mono tabular-nums text-fg">{version}</span></p></div>
      <button type="button" className="analysis-control min-h-11" onClick={check} disabled={busy}>
        <RefreshCw aria-hidden="true" className={`size-4 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`} />{busy ? "Checking…" : "Check for updates"}
      </button>
    </div>
    <p className="mt-3 text-sm text-muted">Checks GitHub only when you ask. Your sessions and settings are not sent.</p>
    <div aria-live="polite" aria-atomic="true" className="mt-3 text-sm">
      {error ? <p className="text-err">{error}</p> : release ? <p>{release.available ? `${release.latest} is available.` : `No newer stable release is available. Latest release: ${release.latest}.`}</p> : null}
    </div>
    <a className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-md text-sm text-accent underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" href={release?.url ?? RELEASES_URL} target="_blank" rel="noopener noreferrer">{release?.available ? "Get update & release notes" : "View releases"}<ExternalLink aria-hidden="true" className="size-3.5" /></a>
    <details className="mt-2 text-sm"><summary className="min-h-11 cursor-pointer py-3 font-medium">How to install an update</summary>
      <div className="space-y-3 text-muted"><p>Stop OpenEval and any running evaluations first. Save local code changes before switching versions. In your OpenEval folder, fetch releases and check your checkout:</p>
        <pre className="overflow-x-auto rounded-lg border border-bd p-3 text-xs text-fg"><code>{"git status --short\ngit fetch origin --tags"}</code></pre>
        <p>With a clean checkout, switch to the release tag shown above, then rebuild and restart:</p>
        <pre className="overflow-x-auto rounded-lg border border-bd p-3 text-xs text-fg"><code>{`git switch --detach ${release?.available ? release.latest : `v${version}`}\nnpm run setup\nnpm run open`}</code></pre>
        <p>Keep your existing data folder and environment settings. This panel checks releases; installation runs in your terminal so rebuilding cannot interrupt the server serving this page.</p>
      </div>
    </details>
  </section>;
}
