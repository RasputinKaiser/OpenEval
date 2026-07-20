"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowRight, Check, CircleDashed, CloudOff, Loader2, RefreshCw, Rocket } from "lucide-react";
import {
  buildGuideSteps,
  type GuideStepStatus,
  type HarnessProbe,
  type Probe,
  type RunProbe,
  type SessionProbe,
} from "./first-run-steps";

/**
 * Dashboard first-run guided path: detect harnesses → view Live sessions →
 * launch first run, each with live detection status. Rendered by the server
 * dashboard only when there are no runs and no collected sessions.
 */
export default function FirstRunGuide() {
  const [harness, setHarness] = useState<Probe<HarnessProbe>>({ phase: "checking" });
  const [sessions, setSessions] = useState<Probe<SessionProbe>>({ phase: "checking" });
  const [runs, setRuns] = useState<Probe<RunProbe>>({ phase: "checking" });
  const [checking, setChecking] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const detect = useCallback(async (refresh: boolean) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setChecking(true);
    setHarness({ phase: "checking" });
    setSessions({ phase: "checking" });
    setRuns({ phase: "checking" });

    const probes: Promise<void>[] = [
      fetch(`/api/harnesses${refresh ? "?refresh=1" : ""}`, { signal: ctrl.signal })
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          const d = (await r.json()) as { harnesses?: { id: string; status: string }[] };
          const all = d.harnesses ?? [];
          setHarness({
            phase: "ready",
            data: { available: all.filter((h) => h.status === "available").map((h) => h.id), total: all.length },
          });
        })
        .catch(() => { if (!ctrl.signal.aborted) setHarness({ phase: "unavailable" }); }),
      fetch("/api/collection?mode=discover", { signal: ctrl.signal })
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          const d = (await r.json()) as { known?: { status: string; parseable?: boolean; sessionCount?: number }[] };
          // Only parseable sources count toward "insights ready" — detect-only
          // sources (Cursor, Cline, …) are surfaced separately, never as done.
          const known = d.known ?? [];
          const parseable = known.filter((s) => s.parseable);
          setSessions({
            phase: "ready",
            data: {
              totalKnownSessions: parseable.reduce((a, s) => a + (s.sessionCount ?? 0), 0),
              presentSources: parseable.filter((s) => s.status === "present").length,
              detectOnlySessions: known.filter((s) => !s.parseable).reduce((a, s) => a + (s.sessionCount ?? 0), 0),
            },
          });
        })
        .catch(() => { if (!ctrl.signal.aborted) setSessions({ phase: "unavailable" }); }),
      fetch("/api/runs", { signal: ctrl.signal })
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          const d = (await r.json()) as { runs?: unknown[] };
          setRuns({ phase: "ready", data: { runCount: (d.runs ?? []).length } });
        })
        .catch(() => { if (!ctrl.signal.aborted) setRuns({ phase: "unavailable" }); }),
    ];
    await Promise.allSettled(probes);
    if (!ctrl.signal.aborted) setChecking(false);
  }, []);

  useEffect(() => {
    detect(false);
    return () => abortRef.current?.abort();
  }, [detect]);

  const steps = buildGuideSteps(harness, sessions, runs);
  const doneCount = steps.filter((s) => s.status === "done").length;

  return (
    <section className="card p-5 md:p-6 mb-4" aria-label="Getting started">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Rocket className="size-4 text-accent-soft" /> Welcome — let&apos;s get your first insight
          </h2>
          <p className="text-sm text-fg-muted mt-1 max-w-xl">
            Nothing has been recorded yet. Three steps take you from a fresh install to a graded eval run.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[11px] text-fg-dim mono tabular-nums">{doneCount}/3 done</span>
          <button
            onClick={() => detect(true)}
            disabled={checking}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-bd text-xs text-fg-muted hover:bg-bg-elev disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={clsx("size-3.5", checking && "animate-spin")} /> Re-check
          </button>
        </div>
      </div>

      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li key={step.key} className="flex flex-wrap sm:flex-nowrap items-start gap-3 p-3.5 rounded-lg border border-bd-subtle bg-bg/40 min-w-0">
            <StepBadge status={step.status} index={i + 1} />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-medium">{step.title}</span>
                <StatusLabel status={step.status} />
              </div>
              <p className="text-xs text-fg-muted mt-0.5">{step.description}</p>
              <p
                className={clsx(
                  "text-[11px] mt-1.5 break-words",
                  step.status === "done" ? "text-ok" : step.status === "unavailable" ? "text-warn" : "text-fg-dim",
                )}
                data-guide-detail={step.key}
              >
                {step.detail}
              </p>
            </div>
            <Link
              href={step.href}
              className={clsx(
                "shrink-0 inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors sm:self-center w-full sm:w-auto",
                step.key === "run" && step.status !== "done"
                  ? "bg-accent hover:bg-accent/90 text-white"
                  : "border border-bd text-fg-muted hover:bg-bg-elev",
              )}
            >
              {step.linkLabel} <ArrowRight className="size-3" />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

function StepBadge({ status, index }: { status: GuideStepStatus; index: number }) {
  return (
    <div
      className={clsx(
        "size-8 rounded-md grid place-items-center shrink-0 mt-0.5",
        status === "done" ? "bg-ok/15" : "bg-accent/10",
      )}
    >
      {status === "done" ? (
        <Check className="size-4 text-ok" />
      ) : status === "checking" ? (
        <Loader2 className="size-4 text-accent-soft animate-spin" />
      ) : (
        <span className="text-sm font-semibold text-accent-soft">{index}</span>
      )}
    </div>
  );
}

function StatusLabel({ status }: { status: GuideStepStatus }) {
  if (status === "done") return <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-ok"><Check className="size-3" /> ready</span>;
  if (status === "checking") return <span className="text-[10px] uppercase tracking-wider text-fg-dim">checking…</span>;
  if (status === "unavailable") return <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-warn"><CloudOff className="size-3" /> status unavailable</span>;
  return <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-fg-dim"><CircleDashed className="size-3" /> waiting</span>;
}
