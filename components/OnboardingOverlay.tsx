"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Terminal } from "lucide-react";
import { cachedFetch } from "@/lib/cached-fetch";

export default function OnboardingOverlay() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem("openeval-onboarding-dismissed");
      if (!dismissed) {
        cachedFetch<{ runs: unknown[] }>("/api/runs")
          .then((d) => { if ((d.runs ?? []).length === 0) setShow(true); })
          .catch(() => setShow(true));
      }
    } catch {}
  }, []);

  function dismiss() {
    try { localStorage.setItem("openeval-onboarding-dismissed", "1"); } catch {}
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={dismiss} />
      <div className="relative w-full max-w-md rounded-lg border border-bd bg-bg-subtle shadow-2xl overflow-hidden" style={{ animation: "menu-enter 200ms cubic-bezier(0.2, 0, 0, 1)" }}>
        <div className="p-6 text-center">
          <div className="mx-auto mb-4 size-12 rounded-lg bg-gradient-to-br from-accent to-accent-soft grid place-items-center">
            <Terminal className="size-6 text-white" />
          </div>
          <h2 className="text-lg font-semibold mb-1">Welcome to OpenEval</h2>
          <p className="text-sm text-fg-muted mb-6">
            Evaluate agent CLIs across SWE, single-tool, reasoning, and visual-code tasks. Here&apos;s how to get started:
          </p>
          <div className="space-y-3 text-left mb-6">
            <div className="flex items-center gap-3 p-3 rounded-lg border border-bd-subtle bg-bg/40">
              <div className="size-8 rounded-md bg-accent/10 grid place-items-center shrink-0">
                <span className="text-sm font-semibold text-accent-soft">1</span>
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium">Start your first run</div>
                <div className="text-[11px] text-fg-muted">Pick cases, choose a harness, and launch.</div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg border border-bd-subtle bg-bg/40">
              <div className="size-8 rounded-md bg-accent/10 grid place-items-center shrink-0">
                <span className="text-sm font-semibold text-accent-soft">2</span>
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium">Watch results stream live</div>
                <div className="text-[11px] text-fg-muted">See tool calls, tokens, and grader results in real time.</div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg border border-bd-subtle bg-bg/40">
              <div className="size-8 rounded-md bg-accent/10 grid place-items-center shrink-0">
                <span className="text-sm font-semibold text-accent-soft">3</span>
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium">Compare harnesses</div>
                <div className="text-[11px] text-fg-muted">Diff results across agent CLIs head-to-head.</div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/runs/new"
              onClick={dismiss}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-accent hover:bg-accent/90 active:scale-[0.96] text-white text-sm font-medium transition-colors"
            >
              Start a run <ArrowRight className="size-4" />
            </Link>
            <button
              onClick={dismiss}
              className="px-4 py-2.5 rounded-md border border-bd text-sm text-fg-muted hover:bg-bg-elev transition-colors"
            >
              Skip
            </button>
          </div>
        </div>
        <div className="border-t border-bd-subtle px-6 py-2 text-[10px] text-fg-dim text-center flex items-center justify-center gap-1">
          <Check className="size-3" /> Press <kbd className="rounded bg-bg-elev px-1 py-0.5">?</kbd> for keyboard shortcuts
        </div>
      </div>
    </div>
  );
}
