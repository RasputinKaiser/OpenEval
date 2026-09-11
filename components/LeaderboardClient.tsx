"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { AlertTriangle, Loader2, Trophy, GitCompareArrows, ArrowUp, ArrowDown } from "lucide-react";
import HarnessBadge from "./HarnessBadge";
import PageHeader from "./PageHeader";
import { cachedFetch } from "@/lib/cached-fetch";
import { fmtDuration, fmtNum, fmtNumFull, fmtPct, fmtUsd } from "@/lib/format";
import EvaluateNav from "./EvaluateNav";
import { ChartFrame } from "./charts/ChartFrame";
import { SelectableBars, type AnalysisBar } from "./charts/SelectableBars";

/** Sticky harness column: row identity stays put while metrics scroll on narrow screens. */
const STICKY_TH = "sticky left-0 z-[2] bg-bg-subtle";
const STICKY_TD = "sticky left-0 z-[1] bg-bg-subtle";
const HARNESS_PARAM = "leaderboardHarness";

interface MetricCoverage {
  total: number;
  available: number;
  missing: number;
  measured: number;
  inferred: number;
  unspecified: number;
  zero: number;
  sum: number;
}

interface WorkloadCategory {
  category: string;
  cases: number;
  uniqueCaseIds: number;
  samples: number;
  passed: number;
  failed: number;
  errored: number;
}

interface WorkloadCase {
  caseId: string;
  cases: number;
  samples: number;
}

interface WorkloadModel {
  model: string;
  cases: number;
  runs: number;
}

interface WorkloadRunReference {
  id: string;
  name: string;
  createdAt: number;
  status: string;
  caseCount: number;
  model: string | null;
}

interface HarnessWorkload {
  categories: WorkloadCategory[];
  caseIds: WorkloadCase[];
  samples: number[];
  models: WorkloadModel[];
  runReferences: WorkloadRunReference[];
  uniqueCaseIds: number;
  sampleCount: number;
  modelCount: number;
  mixed: boolean;
}

interface HarnessAggregate {
  harness: string;
  runCount: number;
  totalCases: number;
  passed: number;
  failed: number;
  errored: number;
  passRate: number;
  totalCostUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalDurationMs: number;
  avgTokPerSec: number;
  model?: string;
  latestRunAt: number | null;
  costCoverage: MetricCoverage;
  durationCoverage: MetricCoverage;
  workload: HarnessWorkload;
}

interface LeaderboardScope {
  latestRuns: number;
  totalRuns: number;
  runLimit: number;
  truncated: boolean;
  description: string;
}

interface LeaderboardPayload {
  harnesses: HarnessAggregate[];
  scope: LeaderboardScope;
}

function useLeaderboardSelection() {
  const [harness, setHarnessState] = useState<string | undefined>();
  const read = useCallback(() => {
    const raw = new URLSearchParams(window.location.search).get(HARNESS_PARAM);
    setHarnessState(raw && raw.length <= 256 && !/[\x00-\x1f]/.test(raw) ? raw : undefined);
  }, []);
  useEffect(() => {
    read();
    window.addEventListener("popstate", read);
    window.addEventListener("openeval:leaderboard-selection", read);
    return () => {
      window.removeEventListener("popstate", read);
      window.removeEventListener("openeval:leaderboard-selection", read);
    };
  }, [read]);
  const setHarness = useCallback((next: string | undefined) => {
    const params = new URLSearchParams(window.location.search);
    if (next) params.set(HARNESS_PARAM, next); else params.delete(HARNESS_PARAM);
    const query = params.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (url !== current) window.history.pushState(window.history.state, "", url);
    window.dispatchEvent(new Event("openeval:leaderboard-selection"));
  }, []);
  return { harness, setHarness };
}

function coverageSources(coverage: MetricCoverage): string {
  const parts: string[] = [];
  if (coverage.measured) parts.push(`${fmtNum(coverage.measured)} measured`);
  if (coverage.inferred) parts.push(`${fmtNum(coverage.inferred)} inferred`);
  if (coverage.unspecified) parts.push(`${fmtNum(coverage.unspecified)} unspecified`);
  if (coverage.missing) parts.push(`${fmtNum(coverage.missing)} missing`);
  return parts.join(" · ") || "no evidence";
}

function metricValue(coverage: MetricCoverage, kind: "cost" | "duration"): string {
  if (!coverage.available) return "—";
  return kind === "cost" ? fmtUsd(coverage.sum) : fmtDuration(coverage.sum);
}

function metricTitle(coverage: MetricCoverage, kind: "cost" | "duration"): string {
  const metric = kind === "cost" ? "cost" : "duration";
  const zero = coverage.zero ? `; ${fmtNum(coverage.zero)} measured value${coverage.zero === 1 ? "" : "s"} are exactly zero` : "";
  return `${metric} coverage: ${fmtNum(coverage.available)} of ${fmtNum(coverage.total)} available · ${coverageSources(coverage)}${zero}`;
}

function workloadSummary(workload: HarnessWorkload): string {
  const categoryText = `${fmtNum(workload.categories.length)} categor${workload.categories.length === 1 ? "y" : "ies"}`;
  const modelText = `${fmtNum(workload.modelCount)} model${workload.modelCount === 1 ? "" : "s"}`;
  return `${categoryText} · ${fmtNum(workload.uniqueCaseIds)} unique case IDs · ${fmtNum(workload.sampleCount)} sample${workload.sampleCount === 1 ? "" : "s"} · ${modelText}`;
}

function LeaderboardSelectionChip({ harness, onClear }: { harness: string; onClear: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Active leaderboard filters">
      <button type="button" className="analysis-control max-w-full" onClick={onClear} aria-label={`Remove ${harness} harness filter`}>
        <span className="truncate">Harness: {harness}</span><span aria-hidden="true">×</span>
      </button>
      <button type="button" className="analysis-control" onClick={onClear}>Reset selection</button>
    </div>
  );
}

function MetricTable({ rows, kind }: { rows: HarnessAggregate[]; kind: "cost" | "duration" }) {
  const label = kind === "cost" ? "Cost" : "Duration";
  return (
    <div className="analysis-table" role="region" tabIndex={0} aria-label={`${label} comparison evidence`}>
      <table className="w-full text-left text-xs">
        <caption className="sr-only">{label} comparison by harness with evidence coverage and provenance</caption>
        <thead><tr><th scope="col">Harness</th><th scope="col" className="text-right">{label}</th><th scope="col" className="text-right">Available</th><th scope="col">Provenance</th><th scope="col" className="text-right">Exact zeroes</th></tr></thead>
        <tbody>
          {rows.map((row) => {
            const coverage = kind === "cost" ? row.costCoverage : row.durationCoverage;
            return <tr key={`${kind}-${row.harness}`}>
              <th scope="row" className="font-normal"><HarnessBadge harness={row.harness} /></th>
              <td className="text-right mono tabular-nums" title={metricTitle(coverage, kind)}>{metricValue(coverage, kind)}</td>
              <td className="text-right mono tabular-nums">{fmtNum(coverage.available)} / {fmtNum(coverage.total)}</td>
              <td className="text-fg-muted">{coverageSources(coverage)}</td>
              <td className="text-right mono tabular-nums">{fmtNum(coverage.zero)}</td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}

function WorkloadDetails({ row }: { row: HarnessAggregate }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        <span className="font-medium text-fg">{row.harness}</span>
        <span>{workloadSummary(row.workload)}</span>
        {row.workload.mixed && <span className="rounded-full border border-warn/35 bg-warn/10 px-2 py-0.5 text-warn">mixed workload · descriptive aggregate</span>}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="analysis-table" role="region" tabIndex={0} aria-label={`${row.harness} workload categories`}>
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Workload categories for {row.harness}</caption>
            <thead><tr><th scope="col">Category</th><th scope="col" className="text-right">Cases</th><th scope="col" className="text-right">Unique IDs</th><th scope="col" className="text-right">Samples</th></tr></thead>
            <tbody>{row.workload.categories.map((category) => <tr key={category.category}><th scope="row" className="font-normal">{category.category}</th><td className="text-right mono">{fmtNum(category.cases)}</td><td className="text-right mono">{fmtNum(category.uniqueCaseIds)}</td><td className="text-right mono">{fmtNum(category.samples)}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="analysis-table" role="region" tabIndex={0} aria-label={`${row.harness} workload models`}>
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Models and run references for {row.harness}</caption>
            <thead><tr><th scope="col">Model</th><th scope="col" className="text-right">Cases</th><th scope="col" className="text-right">Runs</th></tr></thead>
            <tbody>{row.workload.models.map((model) => <tr key={model.model}><th scope="row" className="font-normal mono">{model.model}</th><td className="text-right mono">{fmtNum(model.cases)}</td><td className="text-right mono">{fmtNum(model.runs)}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
      <div>
        <div className="mb-2 text-[10px] uppercase tracking-[0.12em] text-fg-dim">Run references · {fmtNum(row.workload.runReferences.length)} in this leaderboard scope</div>
        <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
          {row.workload.runReferences.map((run) => <Link key={run.id} href={`/runs/${encodeURIComponent(run.id)}`} className="rounded-md border border-bd-subtle bg-bg-subtle px-2.5 py-1.5 text-xs text-accent-soft hover:bg-bg-elev" title={`${run.name} · ${run.status}`}>
            <span className="block max-w-[16rem] truncate">{run.name || run.id}</span>
            <span className="block text-[10px] text-fg-dim">{fmtNum(run.caseCount)} cases{run.model ? ` · ${run.model}` : ""}</span>
          </Link>)}
          {!row.workload.runReferences.length && <span className="text-xs text-fg-dim">No retained run references.</span>}
        </div>
      </div>
      <div className="text-[10px] leading-relaxed text-fg-dim">Case IDs in this profile: {row.workload.caseIds.slice(0, 24).map((item) => `${item.caseId} (${item.samples} sample${item.samples === 1 ? "" : "s"})`).join(" · ") || "none"}{row.workload.caseIds.length > 24 ? ` · +${fmtNum(row.workload.caseIds.length - 24)} more` : ""}</div>
    </div>
  );
}

export default function LeaderboardClient() {
  const [rows, setRows] = useState<HarnessAggregate[]>([]);
  const [scope, setScope] = useState<LeaderboardScope | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<keyof HarnessAggregate>("passRate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const { harness: selectedHarness, setHarness: setSelectedHarness } = useLeaderboardSelection();

  useEffect(() => {
    let cancelled = false;
    cachedFetch<LeaderboardPayload>("/api/harnesses/leaderboard")
      .then((d) => { if (!cancelled) { setRows(d.harnesses || []); setScope(d.scope ?? null); setLoadError(null); } })
      // Never surface a failed fetch as a runtime overlay — show a retryable banner.
      .catch((e) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const sortedRows = useMemo(() => {
    const sorted = [...rows].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return sorted;
  }, [rows, sortKey, sortDir]);

  const selectedRow = useMemo(() => rows.find((row) => row.harness === selectedHarness), [rows, selectedHarness]);

  // "Leading harness" is the pass-rate leader regardless of the table's sort.
  const best = useMemo(
    () => (rows.length ? rows.reduce((acc, r) => (r.passRate > acc.passRate ? r : acc)) : undefined),
    [rows],
  );

  function toggleSort(key: keyof HarnessAggregate) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(typeof sortedRows[0]?.[key] === "string" ? "asc" : "desc");
    }
  }

  const passRows: AnalysisBar[] = rows.map((row) => ({
    id: row.harness,
    label: row.harness,
    value: row.passRate,
    detail: `${fmtPct(row.passRate)} · ${fmtNum(row.totalCases)} graded cases · ${workloadSummary(row.workload)}`,
    tone: row.passRate >= 0.8 ? "ok" : row.passRate >= 0.5 ? "accent" : "err",
  }));

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <PageHeader
        icon={Trophy}
        title="Harness Leaderboard"
        subtitle="Explore observed pass rates, cost, tokens, and speed. These aggregates can contain different cases, samples, and models."
      />
      <EvaluateNav />

      {loadError && (
        <div className="mb-4 rounded-lg border border-err/40 bg-err/10 p-3 flex items-start gap-2.5" role="alert">
          <AlertTriangle className="size-4 text-err shrink-0 mt-0.5" />
          <div className="min-w-0 text-sm">
            <span className="font-medium text-err">Couldn&apos;t load the leaderboard</span>
            <span className="text-fg-muted"> — {loadError}. Reload the page to retry.</span>
          </div>
        </div>
      )}

      {loading ? (
        <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-fg-muted"><Loader2 className="size-4 animate-spin" /> Aggregating runs…</div>
      ) : loadError ? null : rows.length === 0 ? (
        <section className="card p-10 text-center">
          <div className="text-sm text-fg-muted mb-2">No runs yet. Fan a suite across harnesses to populate the leaderboard:</div>
          <pre className="text-[11px] mono bg-bg border border-bd-subtle rounded-md p-3 inline-block text-left mt-2">{`npx tsx lib/cli/run.ts \\\n  --harness claude-code --harness codex \\\n  --parallel 4 --category agentic-swe`}</pre>
          <div className="mt-4"><Link href="/runs/new" className="text-xs text-accent-soft hover:underline">Start a run instead →</Link></div>
        </section>
      ) : (
        <>
          {scope && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-fg-dim">
              <span>{scope.description}</span>
              {scope.truncated && <span className="rounded-full border border-warn/35 bg-warn/10 px-2 py-0.5 text-warn">latest {fmtNum(scope.latestRuns)} of {fmtNum(scope.totalRuns)} runs</span>}
            </div>
          )}
          <p className="mb-4 text-xs text-fg-muted">Descriptive aggregates across retained workloads. Compare matching case and sample sets before interpreting differences as harness performance.</p>
          {best && (
            <section className="card p-4 mb-4 flex items-center gap-3">
              <Trophy className="size-5 text-yellow-500 shrink-0" />
              <div className="text-sm">
                <span className="text-fg-muted">Highest observed pass rate: </span>
                <HarnessBadge harness={best.harness} />
                <span className="ml-1.5 text-[11px] mono text-fg-dim">{best.workload.modelCount > 1 ? `mixed · ${best.workload.modelCount} models` : best.model ?? "model unavailable"}</span>
                <span className="ml-2 mono font-medium tabular-nums">{fmtPct(best.passRate)}</span>
                <span className="text-fg-dim"> across {fmtNum(best.totalCases)} case{best.totalCases === 1 ? "" : "s"} in {fmtNum(best.runCount)} run{best.runCount === 1 ? "" : "s"}</span>
              </div>
            </section>
          )}

          <section className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartFrame
              title="Pass rate by harness"
              description="Click a bar to pin it, then use the explicit Explore action to open that harness's workload and retained run references."
              evidence={{ population: rows.reduce((sum, row) => sum + row.totalCases, 0), eligible: rows.reduce((sum, row) => sum + row.totalCases, 0), plotted: rows.length, scope: "graded cases in latest-run leaderboard scope", provenance: "graded case pass rates" }}
              table={{ headers: ["Harness", "Pass rate", "Cases", "Runs"], rows: rows.map((row) => ({ id: row.harness, cells: [row.harness, fmtPct(row.passRate), fmtNum(row.totalCases), fmtNum(row.runCount)] })) }}
            >
              <SelectableBars rows={passRows} format={(value) => fmtPct(value)} selectedId={selectedHarness} noun="harness runs" onExplore={setSelectedHarness} />
              {selectedHarness && <div className="mt-3"><LeaderboardSelectionChip harness={selectedHarness} onClear={() => setSelectedHarness(undefined)} /></div>}
            </ChartFrame>
            <ChartFrame
              title="Cost and duration comparisons"
              description="Expand the accessible tables to compare only available evidence. Missing metrics remain unavailable; exact zeroes retain their recorded provenance."
              evidence={{ population: rows.length, eligible: rows.filter((row) => row.costCoverage.available > 0 || row.durationCoverage.available > 0).length, scope: "harness aggregates in the latest-run scope", provenance: "runner evidence provenance" }}
              details={<div className="space-y-4"><MetricTable rows={rows} kind="cost" /><MetricTable rows={rows} kind="duration" /></div>}
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-bd-subtle bg-bg-subtle/40 p-3"><div className="text-[10px] uppercase tracking-[0.12em] text-fg-dim">Cost evidence</div><div className="mt-1 text-lg font-semibold mono tabular-nums">{fmtNum(rows.reduce((sum, row) => sum + row.costCoverage.available, 0))} available</div><div className="mt-1 text-[10px] text-fg-dim">{fmtNum(rows.reduce((sum, row) => sum + row.costCoverage.missing, 0))} missing across harness rows</div></div>
                <div className="rounded-lg border border-bd-subtle bg-bg-subtle/40 p-3"><div className="text-[10px] uppercase tracking-[0.12em] text-fg-dim">Duration evidence</div><div className="mt-1 text-lg font-semibold mono tabular-nums">{fmtNum(rows.reduce((sum, row) => sum + row.durationCoverage.available, 0))} available</div><div className="mt-1 text-[10px] text-fg-dim">{fmtNum(rows.reduce((sum, row) => sum + row.durationCoverage.missing, 0))} missing across harness rows</div></div>
              </div>
            </ChartFrame>
          </section>

          {selectedRow && (
            <section className="card mb-4 p-4" aria-labelledby="selected-harness-evidence-title">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div><h2 id="selected-harness-evidence-title" className="text-sm font-medium">Selected harness evidence</h2><p className="mt-1 text-xs text-fg-muted">The URL carries this pinned filter, so Back/Forward and reload restore the same run profile.</p></div>
                <button type="button" className="analysis-control" onClick={() => setSelectedHarness(undefined)}>Clear inspection</button>
              </div>
              <WorkloadDetails row={selectedRow} />
            </section>
          )}

          <section className="card overflow-hidden">
            <div className="chart-scroll-well overflow-x-auto pb-2" tabIndex={0} aria-label="Scrollable harness leaderboard table">
              <table className="w-full min-w-[1040px] text-sm">
                <caption className="sr-only">Harness leaderboard. Pass-rate denominator is total graded cases; cost is in US dollars; token columns show input and output totals.</caption>
                <thead className="sticky top-0 z-10 text-[11px] uppercase tracking-[0.12em] text-fg-muted bg-bg-subtle border-b border-bd-subtle">
                  <tr>
                    <th scope="col" className="text-center px-2 py-2 font-medium w-8">#</th>
                    <th scope="col" aria-sort={sortKey === "harness" ? (sortDir === "asc" ? "ascending" : "descending") : "none"} className={clsx("text-left px-4 py-2 font-medium", STICKY_TH)}>
                      <SortBtn label="Harness" k="harness" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="left" />
                    </th>
                    <th scope="col" aria-sort={sortKey === "runCount" ? (sortDir === "asc" ? "ascending" : "descending") : "none"} className="text-right px-4 py-2 font-medium">
                      <SortBtn label="Runs" k="runCount" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    </th>
                    <th scope="col" aria-sort={sortKey === "totalCases" ? (sortDir === "asc" ? "ascending" : "descending") : "none"} className="text-right px-4 py-2 font-medium">
                      <SortBtn label="Cases" k="totalCases" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    </th>
                    <th scope="col" aria-sort={sortKey === "passRate" ? (sortDir === "asc" ? "ascending" : "descending") : "none"} className="text-right px-4 py-2 font-medium">
                      <SortBtn label="Pass rate" k="passRate" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    </th>
                    <th scope="col" aria-sort={sortKey === "passed" ? (sortDir === "asc" ? "ascending" : "descending") : "none"} className="text-right px-4 py-2 font-medium">
                      <SortBtn label="Passed" k="passed" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    </th>
                    <th scope="col" aria-sort={sortKey === "totalCostUsd" ? (sortDir === "asc" ? "ascending" : "descending") : "none"} className="text-right px-4 py-2 font-medium">
                      <SortBtn label="Cost (USD)" k="totalCostUsd" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    </th>
                    <th scope="col" aria-sort={sortKey === "totalTokensOut" ? (sortDir === "asc" ? "ascending" : "descending") : "none"} className="text-right px-4 py-2 font-medium">
                      <SortBtn label="Tokens (in / out)" k="totalTokensOut" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    </th>
                    <th scope="col" aria-sort={sortKey === "avgTokPerSec" ? (sortDir === "asc" ? "ascending" : "descending") : "none"} className="text-right px-4 py-2 font-medium">
                      <SortBtn label="Avg output tok/s" k="avgTokPerSec" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    </th>
                    <th scope="col" aria-sort={sortKey === "totalDurationMs" ? (sortDir === "asc" ? "ascending" : "descending") : "none"} className="text-right px-4 py-2 font-medium">
                      <SortBtn label="Total time" k="totalDurationMs" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    </th>
                    <th scope="col" aria-sort={sortKey === "model" ? (sortDir === "asc" ? "ascending" : "descending") : "none"} className="text-left px-4 py-2 font-medium">
                      <SortBtn label="Model" k="model" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="left" />
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bd-subtle">
                  {sortedRows.map((r, idx) => (
                    <tr key={`${r.harness}::${r.model ?? ""}`} className={clsx("hover:bg-bg-elev", idx === 0 && sortKey === "passRate" && sortDir === "desc" && "bg-ok/5")}>
                      <td className="px-2 py-2.5 text-center"><span className={clsx("inline-flex items-center justify-center size-5 rounded-full text-[10px] mono font-semibold tabular-nums", idx === 0 ? "bg-yellow-500/15 text-yellow-400" : idx === 1 ? "bg-gray-400/15 text-gray-300" : idx === 2 ? "bg-amber-700/15 text-amber-600" : "text-fg-dim")}>{idx + 1}</span></td>
                      <td className={clsx("px-4 py-2.5", STICKY_TD)}><HarnessBadge harness={r.harness} /></td>
                      <td className="px-4 py-2.5 text-right mono">{r.runCount}</td>
                      <td className="px-4 py-2.5 text-right mono">{r.totalCases}</td>
                      <td className="px-4 py-2.5 text-right"><div className="flex items-center justify-end gap-2"><div className="h-1.5 w-16 overflow-hidden rounded-full bg-bg-elev" role="img" aria-label={`${r.harness}: ${fmtPct(r.passRate)} pass rate; ${r.passed} passed, ${r.failed} failed, ${r.errored} infra errors out of ${r.totalCases} cases`}><div className="h-full flex" aria-hidden="true"><div className="bg-ok" style={{ width: `${boundedPercent(r.passRate)}%` }} />{r.failed > 0 && <div className="bg-err" style={{ width: `${boundedPercent(r.totalCases > 0 ? r.failed / r.totalCases : 0)}%` }} />}{r.errored > 0 && <div className="bg-warn" style={{ width: `${boundedPercent(r.totalCases > 0 ? r.errored / r.totalCases : 0)}%` }} />}</div></div><span className={clsx("mono font-semibold tabular-nums", r.passRate >= 0.8 ? "text-ok" : r.passRate >= 0.5 ? "text-fg-muted" : "text-err")}>{fmtPct(r.passRate)}</span></div></td>
                      <td className="px-4 py-2.5 text-right mono text-xs"><span className="text-ok">{r.passed}</span> / <span className="text-err">{r.failed}</span>{r.errored > 0 && <span className="text-fg-dim"> · {r.errored} err</span>}</td>
                      <td className="px-4 py-2.5 text-right mono" title={metricTitle(r.costCoverage, "cost")}>{metricValue(r.costCoverage, "cost")}</td>
                      <td className="px-4 py-2.5 text-right mono text-xs" title={`${fmtNumFull(r.totalTokensIn)} input / ${fmtNumFull(r.totalTokensOut)} output`}>{fmtNum(r.totalTokensIn)} / {fmtNum(r.totalTokensOut)}</td>
                      <td className="px-4 py-2.5 text-right mono">{Number.isFinite(r.avgTokPerSec) && r.durationCoverage.available > 0 ? r.avgTokPerSec.toFixed(1) : "—"}</td>
                      <td className="px-4 py-2.5 text-right mono" title={metricTitle(r.durationCoverage, "duration")}>{metricValue(r.durationCoverage, "duration")}</td>
                      <td className="px-4 py-2.5 text-[11px] text-fg-dim mono">{r.workload.modelCount > 1 ? `mixed · ${fmtNum(r.workload.modelCount)}` : r.model || r.workload.models[0]?.model || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-bd-subtle px-3 py-2 text-[11px] text-fg-dim sm:hidden">Swipe horizontally to inspect cost, tokens, speed, and model.</p>
          </section>
          <div className="mt-4 flex items-center gap-3 text-xs">
            <Link href="/runs/compare" className="flex items-center gap-1.5 text-accent-soft hover:underline"><GitCompareArrows className="size-3.5" /> Diff two runs</Link>
            <span className="text-fg-dim">·</span>
            <Link href="/harnesses" className="text-accent-soft hover:underline">Inspect discovered harnesses</Link>
          </div>
        </>
      )}
    </div>
  );
}

function SortBtn({ label, k, sortKey, sortDir, onClick, align = "right" }: { label: string; k: keyof HarnessAggregate; sortKey: keyof HarnessAggregate; sortDir: "asc" | "desc"; onClick: (k: keyof HarnessAggregate) => void; align?: "left" | "right" }) {
  const active = sortKey === k;
  return <button type="button" onClick={() => onClick(k)} aria-label={`${label}${active ? `, sorted ${sortDir === "asc" ? "ascending" : "descending"}` : ", not sorted"}`} className={clsx("inline-flex items-center gap-1 hover:text-fg transition-colors", active && "text-accent-soft")}>
    {align === "left" ? label : null}{active && (sortDir === "asc" ? <ArrowUp className="size-2.5" /> : <ArrowDown className="size-2.5" />)}{align === "right" ? label : null}
  </button>;
}

function boundedPercent(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value * 100)) : 0;
}
