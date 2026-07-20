"use client";

import clsx from "clsx";
import HarnessBadge from "../HarnessBadge";
import CopyButton from "./CopyButton";
import { CircleDot, Loader2, XCircle } from "lucide-react";

export interface StatusCounts {
  passed: number;
  failed: number;
  error: number;
  running: number;
  pending: number;
}

export type CancelPhase = "idle" | "cancelling" | "cancelled";

/** Run hero: live status, badges, exports, cancel control, and progress card. */
export default function RunHero({
  runId,
  runName,
  model,
  harness,
  harnessInfo,
  live,
  cancelPhase,
  onCancel,
  counts,
  totalCases,
  visualCount,
  onExportCsv,
  onExportJson,
}: {
  runId: string;
  runName?: string;
  model?: string;
  harness?: string;
  harnessInfo?: { id: string; bin: string | null; version: string | null };
  live: boolean;
  cancelPhase: CancelPhase;
  onCancel: () => void;
  counts: StatusCounts;
  totalCases: number;
  visualCount: number;
  onExportCsv: () => void;
  onExportJson: () => void;
}) {
  const completed = counts.passed + counts.failed + counts.error;
  return (
    <section className="run-hero mb-4 overflow-hidden rounded-lg border border-bd">
      <div className="stagger-grid grid gap-4 p-4 xl:grid-cols-[1fr_360px] xl:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-muted">
            <span className="inline-flex items-center gap-1 rounded border border-accent-soft/30 bg-accent/15 px-2 py-1 text-accent-soft">
              <span className="icon-crossfade relative inline-flex size-3">
              <CircleDot className={clsx("absolute inset-0 size-3", live && "opacity-0")} />
              <Loader2 className={clsx("absolute inset-0 size-3 animate-spin", live ? "opacity-100" : "opacity-0")} />
            </span>
            {live ? "Running eval" : cancelPhase === "cancelled" ? "Run cancelled" : "Eval complete"}
            </span>
            {harness && <HarnessBadge harness={harness} bin={harnessInfo?.bin} version={harnessInfo?.version} />}
            <span className="inline-flex items-center gap-0.5">
              <span className="mono text-fg">{runId}</span>
              <CopyButton text={runId} label="Copy run id" />
            </span>
            {model && <span className="mono text-fg">{model}</span>}
            <a
              href={`/api/runs/${runId}/report?redact=1`}
              className="inline-flex items-center gap-1 rounded border border-bd-subtle bg-bg/60 px-2 py-1 text-fg-muted hover:text-fg"
              title="Download a redacted Markdown report of this run"
            >
              Report .md
            </a>
            <button
              type="button"
              onClick={onExportCsv}
              className="inline-flex items-center gap-1 rounded border border-bd-subtle bg-bg/60 px-2 py-1 text-fg-muted hover:text-fg"
              title="Download case results as CSV"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={onExportJson}
              className="inline-flex items-center gap-1 rounded border border-bd-subtle bg-bg/60 px-2 py-1 text-fg-muted hover:text-fg"
              title="Download this run as JSON"
            >
              Export JSON
            </button>
            {live && (
              <button
                onClick={onCancel}
                disabled={cancelPhase !== "idle"}
                className="inline-flex items-center gap-1 rounded border border-err/30 bg-bg/60 px-2 py-1 text-err hover:bg-err/10 disabled:opacity-50"
                title="Stop this run — queued cases are skipped; in-flight cases finish naturally"
              >
                {cancelPhase === "cancelling" ? <Loader2 className="size-3 animate-spin" /> : <XCircle className="size-3" />}
                Cancel run
              </button>
            )}
            {cancelPhase === "cancelled" && (
              <span className="text-warn">Cancelled — queued cases skipped; in-flight cases finish naturally</span>
            )}
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-normal text-fg md:text-3xl">{runName || "Run output"}</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-fg-muted">
            Watch cases resolve, inspect grader evidence, preview artifacts, and see how much proof backs the score.
          </p>
        </div>
        <div className="rounded-lg border border-bd-subtle bg-bg/55 p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-fg-muted">Progress</span>
            <span className="mono text-fg">{completed}/{totalCases}</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-bg-elev">
            <div className="h-full rounded-full bg-accent-soft transition-[width] duration-300" style={{ width: `${totalCases ? (completed / totalCases) * 100 : 0}%` }} />
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            <RunMetric label="Pass" value={String(counts.passed)} tone="ok" />
            <RunMetric label="Fail" value={String(counts.failed)} tone="err" />
            <RunMetric label="Live" value={String(counts.running)} tone="accent" />
            <RunMetric label="Visual" value={String(visualCount)} tone="visual" />
          </div>
        </div>
      </div>
    </section>
  );
}

function RunMetric({ label, value, tone }: { label: string; value: string; tone: "ok" | "err" | "accent" | "visual" }) {
  const toneClass = {
    ok: "text-ok",
    err: "text-err",
    accent: "text-accent-soft",
    visual: "text-fg",
  }[tone];
  return (
    <div className="rounded border border-bd-subtle bg-bg-subtle/70 px-2 py-2">
      <div className={clsx("mono text-base font-semibold tabular-nums", toneClass)}>{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-fg-dim">{label}</div>
    </div>
  );
}
