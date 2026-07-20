"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Terminal } from "lucide-react";
import { cachedFetch } from "@/lib/cached-fetch";
import { ONBOARDING_DISMISSED_KEY, SHOW_ONBOARDING_EVENT } from "./first-run-steps";

export default function OnboardingOverlay() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(ONBOARDING_DISMISSED_KEY);
      if (!dismissed) {
        cachedFetch<{ runs: unknown[] }>("/api/runs")
          .then((d) => { if ((d.runs ?? []).length === 0) setShow(true); })
          // A failed poll is "unknown", not "new user" — never pop a modal
          // over the app because the API was briefly unreachable.
          .catch(() => {});
      }
    } catch {}
  }, []);

  // Re-entry: Settings dispatches this event to replay the tour on demand.
  useEffect(() => {
    const onShow = () => setShow(true);
    window.addEventListener(SHOW_ONBOARDING_EVENT, onShow);
    return () => window.removeEventListener(SHOW_ONBOARDING_EVENT, onShow);
  }, []);

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show]);

  function dismiss() {
    try { localStorage.setItem(ONBOARDING_DISMISSED_KEY, "1"); } catch {}
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Welcome to OpenEval">
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
                <div className="text-sm font-medium">Detect your agent CLIs</div>
                <div className="text-[11px] text-fg-muted">OpenEval finds ncode, Claude Code, Codex, and custom harnesses on PATH.</div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg border border-bd-subtle bg-bg/40">
              <div className="size-8 rounded-md bg-accent/10 grid place-items-center shrink-0">
                <span className="text-sm font-semibold text-accent-soft">2</span>
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium">See sessions already on this machine</div>
                <div className="text-[11px] text-fg-muted">Live and Collection surface past transcripts before any eval runs.</div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg border border-bd-subtle bg-bg/40">
              <div className="size-8 rounded-md bg-accent/10 grid place-items-center shrink-0">
                <span className="text-sm font-semibold text-accent-soft">3</span>
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium">Launch your first eval run</div>
                <div className="text-[11px] text-fg-muted">Pick cases, choose a harness, and watch graded results stream in.</div>
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
          <Check className="size-3" /> Press <kbd className="rounded bg-bg-elev px-1 py-0.5">?</kbd> for shortcuts · replay this tour anytime from Settings
        </div>
      </div>
    </div>
  );
}
