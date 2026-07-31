"use client";

import clsx from "clsx";
import { Activity, ArrowRight, Clock3, Eye, Gauge, Radio } from "lucide-react";
import type { RunCaseRecord } from "@/lib/types";

interface Props {
  cases: RunCaseRecord[];
  live: boolean;
  onSelect: (index: number) => void;
}

const STATUS_META: Record<RunCaseRecord["status"], { label: string; color: string; className: string }> = {
  passed: { label: "passed", color: "var(--color-ok)", className: "text-ok" },
  failed: { label: "failed", color: "var(--color-err)", className: "text-err" },
  error: { label: "error", color: "var(--color-warn)", className: "text-warn" },
  running: { label: "running", color: "var(--color-accent-soft)", className: "text-accent-soft" },
  grading: { label: "grading", color: "var(--color-accent-soft)", className: "text-accent-soft" },
  pending: { label: "pending", color: "var(--color-fg-dim)", className: "text-fg-dim" },
  skipped: { label: "skipped", color: "var(--color-fg-dim)", className: "text-fg-dim" },
};

/**
 * A compact watch surface for a run: real case state, real timing, and a
 * selectable status ribbon. It deliberately avoids turning a pass rate into
 * a visual-quality claim; artifact evidence is read in the selected case.
 */
export default function EvaluationPulse({ cases, live, onSelect }: Props) {
  const completed = cases.filter((c) => c.status === "passed" || c.status === "failed" || c.status === "error" || c.status === "skipped").length;
  const activeIndex = cases.findIndex((c) => c.status === "running" || c.status === "grading");
  const nextIndex = activeIndex >= 0 ? activeIndex : cases.findIndex((c) => c.status === "pending");
  const active = nextIndex >= 0 ? cases[nextIndex] : null;
  const visualCount = cases.filter((c) => c.case_def.visual?.expected_artifacts?.length).length;
  const finishedWithDuration = cases.filter((c) => c.started_at != null && c.ended_at != null);
  const avgDuration = finishedWithDuration.length
    ? finishedWithDuration.reduce((sum, c) => sum + (c.ended_at! - c.started_at!), 0) / finishedWithDuration.length
    : 0;
  const wallStart = cases.reduce<number | null>((min, c) => c.started_at == null ? min : min == null ? c.started_at : Math.min(min, c.started_at), null);
  const wallEnd = cases.reduce<number | null>((max, c) => {
    const end = c.ended_at ?? (c.status === "running" || c.status === "grading" ? Date.now() : null);
    return end == null ? max : max == null ? end : Math.max(max, end);
  }, null);
  const wallDuration = wallStart != null && wallEnd != null ? wallEnd - wallStart : 0;
  const total = cases.length;

  return (
    <section className="card mb-4 overflow-hidden" aria-labelledby="evaluation-pulse-title" data-testid="evaluation-pulse">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-bd-subtle bg-bg-subtle/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={clsx("grid size-7 place-items-center rounded-md", live ? "text-accent-soft" : "text-fg-muted")} style={{ background: "color-mix(in srgb, var(--color-accent) 12%, transparent)" }}>
            {live ? <Radio aria-hidden="true" className="size-3.5 animate-pulse" /> : <Activity aria-hidden="true" className="size-3.5" />}
          </span>
          <div>
            <h2 id="evaluation-pulse-title" className="text-sm font-medium">Watch run</h2>
            <p className="text-[11px] text-fg-dim">Live case state, timing, and the next evidence surface.</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px] mono text-fg-muted">
          <span className={clsx("inline-flex items-center gap-1.5", live ? "text-accent-soft" : "text-fg-dim")}>
            <span className={clsx("size-1.5 rounded-full", live && "animate-pulse")} style={{ background: live ? "var(--color-accent-soft)" : "var(--color-fg-dim)" }} />
            {live ? "watching" : "settled"}
          </span>
          <span>{completed}/{total || 0} resolved</span>
        </div>
      </div>

      <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(220px,0.8fr)_minmax(190px,0.7fr)]">
        <div className="min-w-0 rounded-lg border border-bd-subtle bg-bg/55 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] uppercase tracking-[0.14em] text-fg-muted">Case stream</div>
            <div className="text-[11px] mono text-fg-dim">{total ? `${Math.round((completed / total) * 100)}% resolved` : "No cases"}</div>
          </div>
          <div className="mt-3 flex h-8 min-w-0 items-stretch gap-1" role="list" aria-label="Run case status stream">
            {cases.length === 0 ? (
              <div className="flex flex-1 items-center justify-center rounded border border-dashed border-bd-subtle text-[11px] text-fg-dim">Cases appear when the run starts.</div>
            ) : cases.map((c, index) => {
              const meta = STATUS_META[c.status];
              return (
                <div key={c.id} role="listitem" className="min-w-[5px] flex-1">
                  <button
                    type="button"
                    aria-label={`Case ${index + 1}: ${c.case_name}, ${meta.label}`}
                    aria-pressed={active?.id === c.id}
                    onClick={() => onSelect(index)}
                    className={clsx("size-full rounded-sm border border-black/20 transition-[filter,transform] hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent", active?.id === c.id && "-translate-y-0.5 ring-2 ring-fg")}
                    style={{ background: meta.color, opacity: c.status === "pending" ? 0.42 : 0.84 }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-fg-dim">
            {Object.entries(STATUS_META).map(([status, meta]) => {
              const count = cases.filter((c) => c.status === status).length;
              if (!count) return null;
              return <span key={status} className="inline-flex items-center gap-1"><span className="size-1.5 rounded-sm" style={{ background: meta.color }} />{meta.label} <span className="mono text-fg">{count}</span></span>;
            })}
          </div>
        </div>

        <div className="rounded-lg border border-bd-subtle bg-bg/55 p-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-fg-muted">Now reading</div>
          {active ? (
            <button type="button" onClick={() => onSelect(nextIndex)} className="mt-2 block w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium">{active.case_name}</span>
                <span className={clsx("shrink-0 text-[10px] mono", STATUS_META[active.status].className)}>{STATUS_META[active.status].label}</span>
              </div>
              <div className="mt-1 truncate text-[10px] text-fg-dim mono">{active.case_id} · {active.category}</div>
              <div className="mt-3 inline-flex items-center gap-1 text-[11px] text-accent-soft">Open evidence <ArrowRight aria-hidden="true" className="size-3" /></div>
            </button>
          ) : (
            <div className="mt-2 text-sm text-fg-muted">{total ? "All cases have settled." : "Waiting for the first case."}</div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1">
          <PulseMetric icon={Clock3} label="Wall time" value={formatDuration(wallDuration)} />
          <PulseMetric icon={Gauge} label="Avg case" value={formatDuration(avgDuration)} />
          <PulseMetric icon={Eye} label="Visual contracts" value={String(visualCount)} />
        </div>
      </div>
    </section>
  );
}

function PulseMetric({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-bd-subtle bg-bg/55 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-fg-muted"><Icon aria-hidden="true" className="size-3" />{label}</div>
      <div className="mt-1 text-sm font-semibold mono tabular-nums">{value}</div>
    </div>
  );
}

function formatDuration(ms: number) {
  if (!ms || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}
