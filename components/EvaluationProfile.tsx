import clsx from "clsx";
import { Activity, Eye, Gauge, Layers3 } from "lucide-react";
import type { RunSummary } from "@/lib/types";

interface Props {
  baseline: { name: string; summary: RunSummary };
  comparison: { name: string; summary: RunSummary };
  visualContractCount: number;
  comparableVisualCount: number;
}
/** A compact, denominator-honest profile of two runs before the case table. */
export default function EvaluationProfile({ baseline, comparison, visualContractCount, comparableVisualCount }: Props) {
  return (
    <section className="card mb-4 overflow-hidden" aria-labelledby="evaluation-profile-title" data-testid="evaluation-profile">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-bd-subtle bg-bg-subtle/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-md text-accent-soft" style={{ background: "color-mix(in srgb, var(--color-accent) 12%, transparent)" }}><Activity aria-hidden="true" className="size-3.5" /></span>
          <div>
            <h2 id="evaluation-profile-title" className="text-sm font-medium">Evaluation profile</h2>
            <p className="text-[11px] text-fg-dim">Outcome shape, throughput, and declared visual coverage. No visual verdict is inferred here.</p>
          </div>
        </div>
        <span className="text-[10px] text-fg-dim mono">A → B</span>
      </div>
      <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(250px,0.65fr)]">
        <div className="rounded-lg border border-bd-subtle bg-bg/55 p-3">
          <div className="mb-3 flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.14em] text-fg-muted"><span>Outcome distribution</span><span className="normal-case tracking-normal mono">cases</span></div>
          <OutcomeBar label={baseline.name} summary={baseline.summary} tone="baseline" />
          <OutcomeBar label={comparison.name} summary={comparison.summary} tone="comparison" />
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-fg-dim">
            <Legend color="var(--color-ok)" label="passed" />
            <Legend color="var(--color-err)" label="failed" />
            <Legend color="var(--color-warn)" label="error" />
            <Legend color="var(--color-fg-dim)" label="other" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
          <ProfileMetric icon={Gauge} label="Pass rate" a={`${Math.round(baseline.summary.passRate * 100)}%`} b={`${Math.round(comparison.summary.passRate * 100)}%`} delta={comparison.summary.passRate - baseline.summary.passRate} />
          <ProfileMetric icon={Activity} label="Avg tok/s" a={tokPerSec(baseline.summary)} b={tokPerSec(comparison.summary)} delta={tokPerSecNumber(comparison.summary) - tokPerSecNumber(baseline.summary)} />
          <ProfileMetric icon={Layers3} label="Visual contracts" a={String(visualContractCount)} b={String(visualContractCount)} note={`${comparableVisualCount} overlap`} />
          <ProfileMetric icon={Eye} label="Errors" a={String(baseline.summary.errored)} b={String(comparison.summary.errored)} delta={comparison.summary.errored - baseline.summary.errored} lowerIsBetter />
        </div>
      </div>
    </section>
  );
}

function OutcomeBar({ label, summary, tone }: { label: string; summary: RunSummary; tone: "baseline" | "comparison" }) {
  const total = Math.max(summary.total, 1);
  const other = Math.max(0, summary.total - summary.passed - summary.failed - summary.errored);
  const segments = [
    { label: "passed", count: summary.passed, color: "var(--color-ok)" },
    { label: "failed", count: summary.failed, color: "var(--color-err)" },
    { label: "error", count: summary.errored, color: "var(--color-warn)" },
    { label: "other", count: other, color: "var(--color-fg-dim)" },
  ];
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex items-center justify-between gap-3 text-[11px]"><span className="min-w-0 truncate font-medium">{label}</span><span className={clsx("mono tabular-nums", tone === "comparison" ? "text-accent-soft" : "text-fg-muted")}>{summary.passed}/{summary.total} passed</span></div>
      <div className="flex h-5 min-w-0 overflow-hidden rounded border border-bd-subtle bg-bg-elev" role="img" aria-label={`${label}: ${segments.filter((s) => s.count > 0).map((s) => `${s.count} ${s.label}`).join(", ") || "no cases"}`}>
        {segments.map((segment) => segment.count > 0 ? <div key={segment.label} title={`${segment.count} ${segment.label}`} style={{ width: `${(segment.count / total) * 100}%`, background: segment.color, opacity: segment.label === "other" ? 0.45 : 0.82 }} /> : null)}
      </div>
    </div>
  );
}

function ProfileMetric({ icon: Icon, label, a, b, delta, note, lowerIsBetter }: { icon: typeof Gauge; label: string; a: string; b: string; delta?: number; note?: string; lowerIsBetter?: boolean }) {
  const good = delta == null ? null : lowerIsBetter ? delta < 0 : delta > 0;
  return (
    <div className="rounded-lg border border-bd-subtle bg-bg/55 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-fg-muted"><Icon aria-hidden="true" className="size-3" />{label}</div>
      <div className="mt-2 flex items-baseline gap-1.5 text-sm mono tabular-nums"><span className="text-fg-muted">{a}</span><span className="text-fg-dim">→</span><span className="font-semibold">{b}</span></div>
      {delta != null ? <div className={clsx("mt-1 text-[10px] mono", good === true ? "text-ok" : good === false ? "text-err" : "text-fg-dim")}>{delta > 0 ? "+" : ""}{typeof delta === "number" && Math.abs(delta) < 1 ? `${(delta * 100).toFixed(0)}pp` : delta.toFixed(1)}</div> : null}
      {note ? <div className="mt-1 text-[10px] text-fg-dim mono">{note}</div> : null}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-sm" style={{ background: color }} />{label}</span>;
}

function tokPerSecNumber(summary: RunSummary) {
  return summary.totalDurationMs > 0 ? summary.totalTokensOut / (summary.totalDurationMs / 1000) : 0;
}

function tokPerSec(summary: RunSummary) {
  const value = tokPerSecNumber(summary);
  return value ? value.toFixed(1) : "—";
}
