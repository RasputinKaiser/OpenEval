"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Check, Terminal, X } from "lucide-react";
import { cachedFetch } from "@/lib/cached-fetch";
import {
  FIRST_RUN_GUIDE_SELECTOR,
  ONBOARDING_DISMISSED_KEY,
  SHOW_ONBOARDING_EVENT,
  shouldShowOnboardingOverlay,
} from "./first-run-steps";

function inlineFirstRunGuideVisible(): boolean {
  return document.querySelector(FIRST_RUN_GUIDE_SELECTOR) !== null;
}

export default function OnboardingOverlay() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  const [manual, setManual] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (pathname !== "/") return;
    try {
      const dismissed = localStorage.getItem(ONBOARDING_DISMISSED_KEY);
      if (!dismissed) {
        Promise.all([
          cachedFetch<{ runs?: unknown[] }>("/api/runs"),
          cachedFetch<{ known?: { parseable?: boolean; sessionCount?: number }[] }>("/api/collection?mode=discover"),
        ])
          .then(([runs, collection]) => {
            // A malformed or partial response is unknown, not proof of a new
            // install. The inline dashboard guide owns the same empty state.
            if (!Array.isArray(runs.runs) || !Array.isArray(collection.known)) return;
            const parseableSessions = collection.known
              .filter((source) => source.parseable)
              .reduce((total, source) => total + (source.sessionCount ?? 0), 0);
            if (shouldShowOnboardingOverlay({
              runCount: runs.runs.length,
              parseableSessionCount: parseableSessions,
              inlineGuideVisible: inlineFirstRunGuideVisible(),
            })) setShow(true);
          })
          // A failed poll is "unknown", not "new user" — never pop a modal
          // over the app because the API was briefly unreachable.
          .catch(() => {});
      }
    } catch {}
  }, [pathname]);

  // The dashboard guide is server-rendered alongside this root-level client
  // component. Hide a pending automatic modal if that guide becomes visible
  // while the discovery requests are settling; manual Settings replay wins.
  useEffect(() => {
    if (!show || manual || pathname !== "/") return;
    const hideIfInlineGuideAppears = () => {
      if (inlineFirstRunGuideVisible()) setShow(false);
    };
    hideIfInlineGuideAppears();
    const observer = new MutationObserver(hideIfInlineGuideAppears);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [manual, pathname, show]);

  // Re-entry: Settings dispatches this event to replay the tour on demand.
  useEffect(() => {
    const onShow = () => {
      restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setManual(true);
      setShow(true);
    };
    window.addEventListener(SHOW_ONBOARDING_EVENT, onShow);
    return () => window.removeEventListener(SHOW_ONBOARDING_EVENT, onShow);
  }, []);

  useEffect(() => {
    if (!show) return;
    restoreFocusRef.current ??= document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? []);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    const focusFirst = window.requestAnimationFrame(() => focusable()[0]?.focus());
    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(focusFirst);
      window.removeEventListener("keydown", onKey);
    };
  }, [show]);

  function dismiss() {
    try { localStorage.setItem(ONBOARDING_DISMISSED_KEY, "1"); } catch {}
    setShow(false);
    setManual(false);
    window.requestAnimationFrame(() => restoreFocusRef.current?.focus());
    restoreFocusRef.current = null;
  }

  if (!show || (pathname !== "/" && !manual)) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" aria-describedby="onboarding-description">
      <div className="absolute inset-0 bg-black/60" onClick={dismiss} />
      <div ref={dialogRef} tabIndex={-1} className="relative w-full max-w-md rounded-lg border border-bd bg-bg-subtle shadow-2xl overflow-hidden" style={{ animation: "menu-enter 200ms cubic-bezier(0.2, 0, 0, 1)" }}>
        <div className="p-6 text-center">
          <button type="button" onClick={dismiss} data-onboarding-close aria-label="Close welcome tour" className="absolute right-3 top-3 min-h-10 min-w-10 grid place-items-center rounded-md text-fg-dim hover:bg-bg-elev hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <X className="size-4" />
          </button>
          <div className="mx-auto mb-4 size-12 rounded-lg bg-gradient-to-br from-accent to-accent-soft grid place-items-center">
            <Terminal className="size-6 text-white" />
          </div>
          <h2 id="onboarding-title" className="text-lg font-semibold mb-1">Welcome to OpenEval</h2>
          <p id="onboarding-description" className="text-sm text-fg-muted mb-6">
            Connect a harness, inspect any existing evidence, then run a focused benchmark. Here&apos;s the short path:
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
