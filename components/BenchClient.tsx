"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  Activity, ArrowDown, ArrowLeft, ArrowUp, BarChart3, Cpu, DollarSign, Eye, Gauge, Hash, Info,
  Layers, Timer, Wrench, Zap, AlertTriangle,
} from "lucide-react";
import type { RunTelemetry } from "@/lib/types";
import { useVisibilityPoll } from "@/lib/use-visibility-poll";

interface PerCase {
  caseId: string; caseName: string; category: string; status: string;
  tokPerSec: number; inTokPerSec: number; toolCallCount: number;
  errorCount: number; cacheHitRate: number; tokensPerCase: number;
  costPerCase: number; msPerTurn: number; msPerTool: number;
  durationMs: number; model: string | null; numTurns: number;
  toolDurationCoverage: number;
  durationSource: "runner_wall" | "cli_result" | "missing";
  tokenSource: "cli_usage" | "missing";
  toolSource: "stream_tool_events" | "summary_counts" | "missing";
  costSource: "measured" | "inferred" | "missing";
  throughputMode: "output_tokens_per_runner_wall_second";
  warnings: string[];
  visualKind: "svg" | "threejs" | "web_ui" | "app_ui" | "screenshot" | "canvas" | "data" | "diagram" | "text" | null;
  visualArtifacts: string[];
}

interface Props {
  runId: string;
  runName: string;
  model?: string | null;
  status?: string;
  createdAt?: number;
}

export default function BenchClient({ runId, runName, model, status, createdAt }: Props) {
  const [telemetry, setTelemetry] = useState<RunTelemetry | null>(null);
  const [perCase, setPerCase] = useState<PerCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<keyof PerCase>("tokPerSec");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(key: keyof PerCase) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  useVisibilityPoll(
    async () => {
      try {
        const response = await fetch(`/api/runs/${runId}/telemetry`);
        if (!response.ok) throw new Error(`Telemetry request failed (${response.status})`);
        const r = await response.json();
        setTelemetry(r.telemetry);
        setPerCase(r.perCase || []);
        setLoadError(null);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Telemetry could not be loaded");
      } finally {
        setLoading(false);
      }
    },
    3000,
    [runId],
  );

  const cases = useMemo(() => {
    const sorted = [...perCase].sort((a, b) => {
      let av: any = (a as any)[sortKey];
      let bv: any = (b as any)[sortKey];
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      av = av ?? 0; bv = bv ?? 0;
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return sorted;
  }, [perCase, sortKey, sortDir]);

  if (loading && !telemetry) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
        <div className="mb-6 h-7 w-48 shimmer rounded" />
        <section className="mb-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-bd-subtle bg-bg-subtle/30 p-3 space-y-2">
              <div className="h-3 w-20 shimmer rounded" />
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="flex items-center justify-between gap-2">
                  <div className="h-3 w-24 shimmer rounded" />
                  <div className="h-4 w-12 shimmer rounded" />
                </div>
              ))}
            </div>
          ))}
        </section>
        <div className="card p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-3 border-b border-bd-subtle last:border-0">
              <div className="h-3 w-32 shimmer rounded" />
              <div className="flex-1 space-y-1">
                <div className="h-3 w-full shimmer rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const t = telemetry;
  const hasTelemetry = Boolean(t?.perCase.length);
  const measuredDurationCases = t?.quality.measuredDurationCases ?? 0;
  const toolEventCases = t?.quality.toolEventCases ?? 0;
  const passingCaseCount = cases.filter((c) => c.status === "passed").length;
  const maxTokPerSec = Math.max(1, ...cases.map((c) => c.tokPerSec));
  const maxTokens = Math.max(1, ...cases.map((c) => c.tokensPerCase));
  const maxCost = Math.max(0.0001, ...cases.map((c) => c.costPerCase));

  const visualCases = cases.filter((c) => c.visualKind);

  return (
    <div className="px-4 pb-8 sm:px-6 lg:px-8">
      <header className="mb-6 rounded-xl border border-bd-subtle bg-bg-subtle/30 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Link href={`/runs/${runId}`} className="inline-flex min-h-9 items-center gap-1.5 text-xs text-fg-muted transition-colors hover:text-fg">
              <ArrowLeft className="size-3.5" /> Back to run
            </Link>
            <div className="mt-3 flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent-soft">
                <BarChart3 className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-accent-soft">Benchmark lab</p>
                <h1 className="mt-1 max-w-[48rem] break-words text-2xl font-semibold tracking-tight text-fg">{runName}</h1>
                <p className="mt-1 text-sm text-fg-muted">Performance, evidence quality, and per-case behavior for this evaluation run.</p>
              </div>
            </div>
          </div>
          <div className="grid min-w-[240px] grid-cols-2 gap-x-5 gap-y-3 text-xs sm:min-w-[310px]">
            <BenchMeta label="Run ID" value={runId} mono />
            <BenchMeta label="Status" value={status ?? "unknown"} tone={status === "completed" ? "ok" : status === "failed" ? "err" : "warn"} />
            <BenchMeta label="Model" value={model || "not reported"} mono />
            <BenchMeta label="Created" value={createdAt ? formatDate(createdAt) : "not recorded"} />
          </div>
        </div>
      </header>

      {loadError && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2.5 text-xs text-warn">
          <span><strong>Telemetry refresh unavailable.</strong> {telemetry ? "Showing the last successful snapshot." : loadError}</span>
          <button type="button" onClick={() => window.location.reload()} className="min-h-9 rounded-md border border-warn/40 px-2.5 py-1.5 font-medium transition-colors hover:bg-warn/10">Retry</button>
        </div>
      )}

      {!hasTelemetry && !loading && !loadError && (
        <section className="card mb-4 border-dashed p-8 text-center" aria-labelledby="benchmark-empty-title">
          <Activity className="mx-auto size-7 text-fg-dim" aria-hidden="true" />
          <h2 id="benchmark-empty-title" className="mt-3 text-sm font-medium">No benchmark telemetry yet</h2>
          <p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-fg-muted">This run has not produced a telemetry snapshot. Start or finish at least one case, then refresh this page to inspect measured performance.</p>
        </section>
      )}

      {hasTelemetry && t && (
        <>
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <MetricGroup label="Throughput">
              <Stat label="Avg output tok/s" value={measuredDurationCases > 0 ? t.avgTokPerSec.toFixed(1) : "—"} icon={Gauge} tone="accent" />
              <Stat label="Max output tok/s" value={measuredDurationCases > 0 ? t.maxTokPerSec.toFixed(1) : "—"} icon={Zap} />
              <Stat label="P50 output tok/s" value={measuredDurationCases > 0 ? t.p50TokPerSec.toFixed(1) : "—"} icon={Zap} />
            </MetricGroup>
            <MetricGroup label="Latency & volume">
              <Stat label="P50 case duration" value={measuredDurationCases > 0 ? fmtMs(t.p50DurationMs) : "—"} icon={Timer} />
              <Stat label="P95 case duration" value={measuredDurationCases > 0 ? fmtMs(t.p95DurationMs) : "—"} icon={Timer} tone={t.p95DurationMs > 60000 ? "warn" : undefined} />
              <Stat label="Avg turns / case" value={t.quality.completedCases > 0 ? t.avgTurns.toFixed(1) : "—"} icon={Hash} />
            </MetricGroup>
            <MetricGroup label="Reliability">
              <Stat label="Fail rate" value={`${((t.failRate ?? 0) * 100).toFixed(0)}%`} icon={AlertTriangle} tone={(t.failRate ?? 0) > 0 ? "warn" : "ok"} />
              <Stat label="Infra errors" value={`${(t.errorRate * 100).toFixed(0)}%`} icon={AlertTriangle} tone={t.errorRate > 0 ? "err" : "ok"} />
              <Stat label="Fails safely" value={`${(t.failsSafelyRate * 100).toFixed(0)}%`} icon={Layers} tone={t.failsSafelyRate >= 1 ? "ok" : "warn"} />
            </MetricGroup>
            <MetricGroup label="Cost & tooling">
              <Stat label="Cheapest passing case" value={passingCaseCount > 0 ? `$${t.cheapestPassUsd.toFixed(4)}` : "—"} icon={DollarSign} tone="accent" />
              <Stat label="Total tool calls" value={toolEventCases > 0 ? String(t.totalToolCalls) : "—"} icon={Wrench} />
              <Stat label="Cases in run" value={String(t.perCase.length)} icon={Activity} />
            </MetricGroup>
          </section>

          <section className="card p-5 mb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium flex items-center gap-2">
                  <Gauge className="size-4 text-accent-soft" /> Telemetry integrity
                </h2>
                <p className="mt-1 text-xs text-fg-muted">
                  Throughput = output tokens ÷ runner wall-clock seconds. “Measured” means the underlying usage or event evidence is present; unknown values are not treated as zero-quality passes.
                </p>
              </div>
              <span className={clsx(
                "rounded border px-2 py-1 text-xs mono",
                t.quality.warnings.length ? "border-warn/30 bg-warn/10 text-warn" : "border-ok/30 bg-ok/10 text-ok"
              )}>
                {t.quality.warnings.length ? "review" : "measured"}
              </span>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-4">
              <IntegrityStat label="Duration" value={`${t.quality.measuredDurationCases}/${t.quality.completedCases}`} detail="runner wall-clock" ok={t.quality.measuredDurationCases === t.quality.completedCases} />
              <IntegrityStat label="Usage" value={`${t.quality.usageReportedCases}/${t.quality.completedCases}`} detail="CLI usage payload" ok={t.quality.usageReportedCases === t.quality.completedCases} />
              <IntegrityStat label="Tool events" value={`${t.quality.toolEventCases}/${t.quality.completedCases}`} detail="streamed calls" ok={t.quality.toolEventCases === t.quality.completedCases} />
              <IntegrityStat label="Tool timing" value={`${Math.round(t.quality.toolDurationCoverage * 100)}%`} detail="matched result durations" ok={t.quality.toolDurationCoverage >= 0.95} />
            </div>
            {t.quality.warnings.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {t.quality.warnings.map((warning) => (
                  <span key={warning} className="rounded border border-warn/30 bg-warn/10 px-2 py-1 text-[11px] text-warn">
                    {warning}
                  </span>
                ))}
              </div>
            )}
          </section>

          {visualCases.length > 0 && <VisualLaneSection runId={runId} cases={visualCases} />}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <ScatterSection cases={cases} maxTokens={maxTokens} maxCost={maxCost} />
            <TokPerSecSection cases={cases} maxTokPerSec={maxTokPerSec} />
          </div>

          <section className="card p-5 mb-4">
            <h2 className="text-sm font-medium mb-4 flex items-center gap-2">
              <Wrench className="size-4 text-fg-muted" /> Tool calls by name
            </h2>
            <p className="mb-4 text-xs text-fg-muted">Counts come from the recorded tool-call evidence for this run.</p>
            <div className="space-y-2">
              {t.topTools.length === 0 && <div className="rounded border border-dashed border-bd-subtle p-4 text-sm text-fg-muted">No tool-call evidence was recorded for this run.</div>}
              {t.topTools.map((tool) => {
                const pct = t.totalToolCalls > 0 ? (tool.count / t.totalToolCalls) * 100 : 0;
                return (
                  <div key={tool.name} className="flex items-center gap-3">
                    <span className="text-xs mono w-40 shrink-0 text-fg-muted">{tool.name}</span>
                    <div className="flex-1 h-4 bg-bg-elev rounded overflow-hidden">
                      <div className="h-full bg-accent/60 transition-[width] duration-300" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs mono w-16 text-right">{tool.count}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-bd-subtle px-4 py-3">
              <div>
                <h2 className="text-sm font-medium">Per-case performance</h2>
                <p className="mt-1 text-xs text-fg-muted">Output generation rate, cost, latency, tools, and evidence provenance for every case. Select a column to sort.</p>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] text-fg-dim"><Info className="size-3.5" /> Units are shown in each heading</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-sm">
                <caption className="sr-only">Per-case benchmark performance and measurement provenance</caption>
                <thead className="sticky top-0 z-10 text-[11px] uppercase tracking-wider text-fg-muted bg-bg-subtle border-b border-bd-subtle">
                  <tr>
                    <th scope="col" aria-sort={sortAria(sortKey, "caseName", sortDir)} className="text-left px-4 py-2 font-medium"><SortBtn label="Case" k="caseName" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="left" /></th>
                    <th scope="col" aria-sort={sortAria(sortKey, "tokPerSec", sortDir)} className="text-right px-4 py-2 font-medium"><SortBtn label="Output tok/s" k="tokPerSec" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} /></th>
                    <th scope="col" aria-sort={sortAria(sortKey, "inTokPerSec", sortDir)} className="text-right px-4 py-2 font-medium"><SortBtn label="Input tok/s" k="inTokPerSec" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} /></th>
                    <th scope="col" aria-sort={sortAria(sortKey, "tokensPerCase", sortDir)} className="text-right px-4 py-2 font-medium"><SortBtn label="Tokens (in + out)" k="tokensPerCase" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} /></th>
                    <th scope="col" aria-sort={sortAria(sortKey, "costPerCase", sortDir)} className="text-right px-4 py-2 font-medium"><SortBtn label="Est. cost (USD)" k="costPerCase" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} /></th>
                    <th scope="col" aria-sort={sortAria(sortKey, "durationMs", sortDir)} className="text-right px-4 py-2 font-medium"><SortBtn label="Wall time" k="durationMs" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} /></th>
                    <th scope="col" aria-sort={sortAria(sortKey, "toolCallCount", sortDir)} className="text-right px-4 py-2 font-medium"><SortBtn label="Tool calls" k="toolCallCount" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} /></th>
                    <th scope="col" aria-sort={sortAria(sortKey, "msPerTool", sortDir)} className="text-right px-4 py-2 font-medium"><SortBtn label="Avg tool time" k="msPerTool" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} /></th>
                    <th scope="col" className="text-left px-4 py-2 font-medium">Evidence</th>
                    <th scope="col" aria-sort={sortAria(sortKey, "numTurns", sortDir)} className="text-right px-4 py-2 font-medium"><SortBtn label="Turns" k="numTurns" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} /></th>
                    <th scope="col" aria-sort={sortAria(sortKey, "status", sortDir)} className="text-left px-4 py-2 font-medium"><SortBtn label="Result" k="status" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="left" /></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bd-subtle">
                  {cases.map((c) => (
                    <tr key={c.caseId} className={clsx("hover:bg-bg-elev", c.status === "failed" && "bg-err/5", c.status === "error" && "bg-warn/5")}>
                      <td className="px-4 py-2">
                        <Link href={`/runs/${runId}/case/${c.caseId}`} className="hover:text-accent-soft">
                          {c.caseName}
                        </Link>
                        <div className="text-[10px] text-fg-dim mono">{c.model || "—"}</div>
                      </td>
                      <td className="px-4 py-2 text-right mono">{c.durationSource === "runner_wall" && c.tokenSource === "cli_usage" ? c.tokPerSec.toFixed(1) : "—"}</td>
                      <td className="px-4 py-2 text-right mono text-fg-muted">{c.durationSource === "runner_wall" && c.tokenSource === "cli_usage" ? c.inTokPerSec.toFixed(1) : "—"}</td>
                      <td className="px-4 py-2 text-right mono">{c.tokenSource === "cli_usage" ? c.tokensPerCase.toLocaleString() : "—"}</td>
                      <td className="px-4 py-2 text-right mono">{formatCost(c)}</td>
                      <td className="px-4 py-2 text-right mono">{fmtMs(c.durationMs)}</td>
                      <td className="px-4 py-2 text-right mono">{c.toolSource === "missing" ? "—" : c.toolCallCount}</td>
                      <td className="px-4 py-2 text-right mono">{c.msPerTool ? fmtMs(c.msPerTool) : "—"}</td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          <SourceChip label="wall clock" ok={c.durationSource === "runner_wall"} />
                          <SourceChip label="CLI usage" ok={c.tokenSource === "cli_usage"} />
                          <SourceChip label="stream events" ok={c.toolSource === "stream_tool_events"} />
                          <SourceChip label={c.costSource === "measured" ? "measured cost" : c.costSource === "inferred" ? "estimated cost" : "cost missing"} ok={c.costSource !== "missing"} />
                        </div>
                        {c.warnings.length > 0 && <div className="mt-1 text-[10px] text-warn">{c.warnings[0]}</div>}
                      </td>
                      <td className="px-4 py-2 text-right mono">{c.numTurns}</td>
                      <td className="px-4 py-2">
                        <span className={clsx(
                          "text-[10px] px-1.5 py-0.5 rounded mono",
                          c.status === "passed" ? "bg-ok/10 text-ok" :
                          c.status === "failed" ? "bg-err/10 text-err" :
                          c.status === "error" ? "bg-err/10 text-err" :
                          "bg-bg-elev text-fg-muted"
                        )}>{c.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function BenchMeta({ label, value, mono, tone }: { label: string; value: string; mono?: boolean; tone?: "ok" | "warn" | "err" }) {
  const toneClass = tone === "ok" ? "text-ok" : tone === "err" ? "text-err" : tone === "warn" ? "text-warn" : "text-fg";
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-fg-dim">{label}</div>
      <div className={clsx("mt-0.5 truncate text-xs", mono && "mono", toneClass)}>{value}</div>
    </div>
  );
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(timestamp);
}

function VisualLaneSection({ runId, cases }: { runId: string; cases: PerCase[] }) {
  return (
    <section className="card mb-4 p-5" aria-labelledby="visual-lanes-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="visual-lanes-title" className="flex items-center gap-2 text-sm font-medium">
            <Eye className="size-4 text-accent-soft" /> Visual benchmark lanes
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-fg-muted">
            Declared visual cases are shown by contract type. Artifact existence and bytes are evidence; visual quality still requires an explicit visual grader or human review.
          </p>
        </div>
        <Link href={`/runs/compare?a=${encodeURIComponent(runId)}`} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-bd px-3 py-2 text-xs text-accent-soft transition-colors hover:bg-bg-elev">
          Compare visual outputs <ArrowUp className="size-3.5 rotate-45" />
        </Link>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {cases.map((c) => (
          <Link key={c.caseId} href={`/runs/${runId}/case/${c.caseId}`} className="group rounded-lg border border-bd-subtle bg-bg/35 p-3 transition-colors hover:border-accent/50 hover:bg-bg-elev">
            <div className="flex items-start justify-between gap-2">
              <span className="line-clamp-2 text-sm text-fg group-hover:text-accent-soft">{c.caseName}</span>
              <span className="shrink-0 rounded border border-accent/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-accent-soft">{visualKindLabel(c.visualKind)}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-muted">
              <span>{c.visualArtifacts.length} expected artifact{c.visualArtifacts.length === 1 ? "" : "s"}</span>
              <span className={c.status === "passed" ? "text-ok" : c.status === "failed" ? "text-err" : "text-warn"}>{statusLabel(c.status)}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function visualKindLabel(kind: PerCase["visualKind"]): string {
  if (kind === "svg") return "SVG";
  if (kind === "threejs") return "3D";
  if (kind === "web_ui") return "Web UI";
  if (kind === "app_ui") return "App UI";
  if (kind === "screenshot") return "Screenshot";
  if (kind === "canvas") return "Canvas";
  if (kind === "data") return "Data artifact";
  if (kind === "diagram") return "Diagram";
  if (kind === "text") return "Text artifact";
  return "Visual";
}

function statusLabel(status: string): string {
  if (status === "passed") return "Passed";
  if (status === "failed") return "Failed";
  if (status === "error") return "Infra error";
  return status;
}

function IntegrityStat({ label, value, detail, ok }: { label: string; value: string; detail: string; ok: boolean }) {
  return (
    <div className="rounded border border-bd-subtle bg-bg/50 p-3">
      <div className="text-[10px] uppercase tracking-wider text-fg-muted">{label}</div>
      <div className={clsx("mt-1 mono text-base font-semibold", ok ? "text-ok" : "text-warn")}>{value}</div>
      <div className="mt-0.5 text-[10px] text-fg-dim">{detail}</div>
    </div>
  );
}

function SourceChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={clsx(
      "rounded border px-1.5 py-0.5 text-[10px] mono",
      ok ? "border-ok/30 bg-ok/10 text-ok" : "border-warn/30 bg-warn/10 text-warn"
    )}>
      {label}
    </span>
  );
}

function fmtMs(ms: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
  return `${m}m${s}s`;
}

function MetricGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-bd-subtle bg-bg-subtle/30 p-3 space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-fg-dim">{label}</div>
      {children}
    </div>
  );
}

function Stat({ label, value, icon: Icon, tone }: { label: string; value: string; icon: any; tone?: "ok" | "warn" | "err" | "accent" }) {
  const c = tone === "ok" ? "text-ok" : tone === "err" ? "text-err" : tone === "warn" ? "text-warn" : tone === "accent" ? "text-accent-soft" : "text-fg";
  return (
    <div className="flex items-baseline justify-between gap-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-fg-muted">
        <Icon className="size-3" /> {label}
      </div>
      <div className={`text-base font-semibold mono tabular-nums ${c}`}>{value}</div>
    </div>
  );
}

function ScatterSection({ cases, maxTokens, maxCost }: { cases: PerCase[]; maxTokens: number; maxCost: number }) {
  const plottedCases = cases.filter((c) => c.tokensPerCase > 0 && Number.isFinite(c.tokensPerCase) && Number.isFinite(c.costPerCase) && c.costSource !== "missing");
  const [selectedCaseId, setSelectedCaseId] = useState(plottedCases[0]?.caseId ?? null);
  const xTicks = niceTicks(maxTokens, 5);
  const yTicks = niceTicks(maxCost, 5);
  const xMax = xTicks[xTicks.length - 1] || 1;
  const yMax = yTicks[yTicks.length - 1] || 1;
  const selected = plottedCases.find((c) => c.caseId === selectedCaseId) ?? plottedCases[0];
  const W = 560, H = 300, left = 70, right = 18, top = 18, bottom = 58;
  const plotW = W - left - right;
  const plotH = H - top - bottom;
  const ix = (v: number) => left + (v / xMax) * plotW;
  const iy = (v: number) => top + plotH - (v / yMax) * plotH;

  useEffect(() => {
    if (!plottedCases.some((c) => c.caseId === selectedCaseId)) setSelectedCaseId(plottedCases[0]?.caseId ?? null);
  }, [plottedCases, selectedCaseId]);

  if (plottedCases.length === 0) {
    return (
      <section className="card p-4 sm:p-5" aria-labelledby="tokens-cost-title">
        <h2 id="tokens-cost-title" className="flex items-center gap-2 text-sm font-medium"><Cpu className="size-4 text-fg-muted" /> Tokens vs estimated cost</h2>
        <p className="mt-1 text-xs text-fg-muted">Horizontal axis: total tokens (input + output). Vertical axis: estimated cost (USD).</p>
        <div className="mt-4 flex min-h-[180px] flex-col items-center justify-center rounded-lg border border-dashed border-bd-subtle px-6 text-center" role="status">
          <Cpu className="size-5 text-fg-dim" aria-hidden="true" />
          <div className="mt-2 text-sm font-medium text-fg">No plottable token and cost evidence</div>
          <p className="mt-1 max-w-sm text-xs leading-5 text-fg-muted">The chart needs both token totals and a measured or estimated USD value. Missing evidence remains unavailable instead of being plotted as zero.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="tokens-cost-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="tokens-cost-title" className="text-sm font-medium flex items-center gap-2">
            <Cpu className="size-4 text-fg-muted" /> Tokens vs estimated cost
          </h2>
          <p className="mt-1 text-xs text-fg-muted">Each point is one case. Total tokens = input + output; more tokens and higher estimated cost move toward the top-right.</p>
        </div>
        <span className="inline-flex items-center gap-1 text-[11px] text-accent-soft"><Info className="size-3.5" /> Select a point</span>
      </div>
      <svg data-testid="benchmark-scatter-chart" viewBox={`0 0 ${W} ${H}`} className="mt-3 h-auto w-full overflow-visible" role="img" aria-labelledby="tokens-cost-chart-title tokens-cost-chart-desc">
        <title id="tokens-cost-chart-title">Output tokens compared with estimated cost per case</title>
        <desc id="tokens-cost-chart-desc">The horizontal axis shows total input plus output tokens and the vertical axis shows estimated cost in US dollars. Point color indicates the case result.</desc>
        {yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line x1={left} y1={iy(tick)} x2={W - right} y2={iy(tick)} stroke="#25252c" strokeWidth={1} />
            <text x={left - 9} y={iy(tick) + 3} textAnchor="end" className="fill-fg-dim" style={{ fontSize: 10 }}>{formatUsdTick(tick)}</text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <g key={`x-${tick}`}>
            <line x1={ix(tick)} y1={top} x2={ix(tick)} y2={top + plotH} stroke="#25252c" strokeWidth={1} />
            <text x={ix(tick)} y={top + plotH + 17} textAnchor="middle" className="fill-fg-dim" style={{ fontSize: 10 }}>{formatTokenTick(tick)}</text>
          </g>
        ))}
        <text x={left + plotW / 2} y={H - 8} textAnchor="middle" className="fill-fg-muted" style={{ fontSize: 10 }}>Total tokens (input + output)</text>
        <text x={15} y={top + plotH / 2} textAnchor="middle" transform={`rotate(-90 15 ${top + plotH / 2})`} className="fill-fg-muted" style={{ fontSize: 10 }}>Estimated cost (USD)</text>
        {plottedCases.map((c) => {
          const color = statusColor(c.status);
          const selectedPoint = c.caseId === selected?.caseId;
          return (
            <g
              key={c.caseId}
              role="button"
              tabIndex={0}
              aria-label={`${c.caseName}, ${formatTokenTick(c.tokensPerCase)} total tokens, ${formatCost(c)}, ${statusLabel(c.status)}`}
              onClick={() => setSelectedCaseId(c.caseId)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedCaseId(c.caseId); } }}
              className="cursor-pointer"
            >
              {selectedPoint && <circle cx={ix(c.tokensPerCase)} cy={iy(c.costPerCase)} r={8} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} />}
              <circle cx={ix(c.tokensPerCase)} cy={iy(c.costPerCase)} r={5} fill={color} fillOpacity={0.8} stroke={color} strokeWidth={1.5}>
                <title>{`${c.caseName}\n${formatTokenTick(c.tokensPerCase)} total tokens · ${formatCost(c)} · ${statusLabel(c.status)}`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
      <div className="mt-3 grid gap-2 rounded-lg border border-bd-subtle bg-bg/35 p-3 text-xs sm:grid-cols-4">
        <div className="sm:col-span-2"><div className="text-[10px] uppercase tracking-wider text-fg-dim">Selected case</div><div className="mt-1 truncate text-fg">{selected?.caseName ?? "No cases"}</div></div>
        <Datum label="Total tokens (in + out)" value={selected ? formatTokenTick(selected.tokensPerCase) : "—"} />
        <Datum label="Estimated cost" value={selected ? formatCost(selected) : "—"} />
      </div>
      <ChartLegend />
      <p className="mt-2 text-[11px] leading-4 text-fg-dim">Estimated cost is a local pricing calculation, not provider spend. {cases.length - plottedCases.length > 0 ? `${cases.length - plottedCases.length} case${cases.length - plottedCases.length === 1 ? " is" : "s are"} omitted because token or cost evidence is unavailable.` : "All cases with token and cost evidence are plotted."}</p>
    </section>
  );
}

function TokPerSecSection({ cases, maxTokPerSec }: { cases: PerCase[]; maxTokPerSec: number }) {
  const ranked = cases.filter((c) => c.durationSource === "runner_wall" && c.tokenSource === "cli_usage" && Number.isFinite(c.tokPerSec)).sort((a, b) => b.tokPerSec - a.tokPerSec);
  const ticks = niceTicks(maxTokPerSec, 5);
  const maxScale = ticks[ticks.length - 1] || 1;
  if (ranked.length === 0) {
    return (
      <section className="card p-4 sm:p-5" aria-labelledby="throughput-title">
        <h2 id="throughput-title" className="flex items-center gap-2 text-sm font-medium"><Gauge className="size-4 text-fg-muted" /> Output throughput per case</h2>
        <p className="mt-1 text-xs text-fg-muted">Horizontal scale: output tokens per runner wall-clock second.</p>
        <div className="mt-4 flex min-h-[180px] flex-col items-center justify-center rounded-lg border border-dashed border-bd-subtle px-6 text-center" role="status">
          <Gauge className="size-5 text-fg-dim" aria-hidden="true" />
          <div className="mt-2 text-sm font-medium text-fg">No measured throughput evidence</div>
          <p className="mt-1 max-w-sm text-xs leading-5 text-fg-muted">A case must report both runner wall time and CLI token usage before it appears on this chart.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="throughput-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="throughput-title" className="text-sm font-medium flex items-center gap-2">
            <Gauge className="size-4 text-fg-muted" /> Output throughput per case
          </h2>
          <p className="mt-1 text-xs text-fg-muted">Ranked output generation speed. Each bar is output tokens divided by runner wall-clock seconds.</p>
        </div>
        <span className="text-[11px] text-fg-dim">{ranked.length} case{ranked.length === 1 ? "" : "s"}</span>
      </div>
      <div data-testid="benchmark-throughput-chart" className="mt-4 rounded-lg border border-bd-subtle bg-bg/25 p-3" role="img" aria-label="Ranked output throughput per case in tokens per second">
        <div className="grid grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)_4.5rem] items-end gap-2 text-[10px] uppercase tracking-wider text-fg-dim sm:grid-cols-[minmax(10rem,13rem)_minmax(0,1fr)_5rem]">
          <span>Case (ranked)</span>
          <div className="relative h-5 border-b border-bd-subtle">
            {ticks.map((tick) => <span key={tick} className="absolute bottom-1 -translate-x-1/2 mono normal-case tracking-normal" style={{ left: `${(tick / maxScale) * 100}%` }}>{formatNumberTick(tick)}</span>)}
          </div>
          <span className="text-right normal-case tracking-normal">Output tok/s</span>
        </div>
        <div className="mt-2 max-h-[430px] space-y-1.5 overflow-y-auto pr-1">
          {ranked.map((c, index) => {
            const color = statusColor(c.status);
            return (
              <div key={c.caseId} className="grid grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)_4.5rem] items-center gap-2 rounded-md px-1 py-1.5 transition-colors hover:bg-bg-elev sm:grid-cols-[minmax(10rem,13rem)_minmax(0,1fr)_5rem]">
                <div className="min-w-0">
                  <div className="truncate text-xs text-fg" title={c.caseName}><span className="mr-1.5 text-[10px] text-fg-dim">{index + 1}.</span>{c.caseName}</div>
                  <div className="ml-4 text-[10px] text-fg-dim">{statusLabel(c.status)}</div>
                </div>
                <div className="relative h-6 overflow-hidden rounded border border-bd-subtle" style={{ backgroundImage: "linear-gradient(to right, transparent 24.8%, #25252c 25%, transparent 25.2%, transparent 49.8%, #25252c 50%, transparent 50.2%, transparent 74.8%, #25252c 75%, transparent 75.2%)" }}>
                  <div className="h-full rounded transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(100, (c.tokPerSec / maxScale) * 100))}%`, backgroundColor: color }} />
                </div>
                <span className="text-right font-mono text-xs tabular-nums text-fg">{c.tokPerSec.toFixed(1)}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-3 text-center text-[11px] text-fg-muted">Output generation rate (tokens per second)</div>
      </div>
      <ChartLegend />
      <p className="mt-2 text-[11px] leading-4 text-fg-dim">This is runner-wall throughput. It is not a measure of answer quality, and it does not include time outside the recorded runner duration.</p>
    </section>
  );
}

function ChartLegend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-fg-muted" aria-label="Result legend">
      <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-ok" /> Passed</span>
      <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-err" /> Failed</span>
      <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-warn" /> Infra error</span>
    </div>
  );
}

function Datum({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[10px] uppercase tracking-wider text-fg-dim">{label}</div><div className="mt-1 mono text-fg">{value}</div></div>;
}

function niceTicks(max: number, count: number): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const rawStep = max / Math.max(count - 1, 1);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const factor = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
  const step = factor * magnitude;
  const end = Math.ceil(max / step) * step;
  return Array.from({ length: Math.max(2, Math.round(end / step) + 1) }, (_, i) => i * step);
}

function formatNumberTick(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return value.toFixed(value < 10 && value % 1 !== 0 ? 1 : 0);
}

function formatTokenTick(value: number): string {
  return `${formatNumberTick(value)}`;
}

function formatUsd(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(3)}`;
}

function formatUsdTick(value: number): string {
  if (value === 0) return "$0";
  return `$${value.toFixed(value < 0.1 ? 3 : 2)}`;
}

function formatCost(c: Pick<PerCase, "costPerCase" | "costSource">): string {
  if (c.costSource === "missing") return "Unavailable";
  const value = formatUsd(c.costPerCase);
  return c.costSource === "inferred" ? `~${value}` : value;
}

function statusColor(status: string): string {
  if (status === "passed") return "#3fb950";
  if (status === "error") return "#d29922";
  if (status === "failed") return "#f85149";
  return "#737380";
}

function SortBtn({
  label, k, sortKey, sortDir, onClick, align = "right",
}: {
  label: string; k: keyof PerCase; sortKey: keyof PerCase; sortDir: "asc" | "desc";
  onClick: (k: keyof PerCase) => void; align?: "left" | "right";
}) {
  const active = sortKey === k;
  return (
    <button
      type="button"
      onClick={() => onClick(k)}
      aria-label={`${label}${active ? `, sorted ${sortDir === "asc" ? "ascending" : "descending"}` : ", not sorted"}`}
      className={clsx("inline-flex items-center gap-1 hover:text-fg transition-colors", active && "text-accent-soft")}
    >
      {align === "left" && label}
      {active && (sortDir === "asc" ? <ArrowUp className="size-2.5" /> : <ArrowDown className="size-2.5" />)}
      {align === "right" && label}
    </button>
  );
}

function sortAria(activeKey: keyof PerCase, key: keyof PerCase, direction: "asc" | "desc"): "ascending" | "descending" | "none" {
  if (activeKey !== key) return "none";
  return direction === "asc" ? "ascending" : "descending";
}
