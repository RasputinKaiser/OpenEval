"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { SessionEvidenceLink } from "./SessionEvidenceLink";
import { AlertTriangle, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { SavedAnalysisViews } from "./charts/SavedAnalysisViews";
import { TimeSeriesChart } from "./charts/TimeSeriesChart";
import { ChartFrame } from "./charts/ChartFrame";
import { SelectableBars, type AnalysisBar } from "./charts/SelectableBars";
import { DateRangeControls, SelectionChips } from "./charts/SelectionControls";
import { chartSelectionHref, selectionParams, type ChartSelection } from "@/lib/chart-analysis";
import { useChartSelection } from "@/lib/use-chart-selection";
import type {
  AnalysisGroup,
  AnalysisReport,
  AnalysisSessionEvidence,
  AnalysisTimeBucket,
} from "@/lib/collection/analysis";
import { fmtDateTime, fmtDuration, fmtNum, fmtNumFull, fmtUsd } from "@/lib/format";

const PAGE_SIZE = 80;
type DistributionMetric = "tokens" | "duration";

function nullable(value: number | null, format: (value: number) => string): string {
  return value === null ? "—" : format(value);
}

function binLabel(min: number, max: number | undefined, metric: DistributionMetric): string {
  const unit = metric === "tokens" ? "tokens" : "duration";
  if (max === undefined) return `≥ ${fmtNumFull(min)} ${unit}`;
  if (max === min + 1) return `${fmtNumFull(min)} ${unit}`;
  return `${fmtNumFull(min)}–${fmtNumFull(max - 1)} ${unit}`;
}

function groupDetail(group: AnalysisGroup): string {
  const parts = [
    group.tokens === null ? null : `${fmtNum(group.tokens)} tokens`,
    group.costUsd === null ? null : `${fmtUsd(group.costUsd)} API eq.`,
    group.toolCalls === null ? null : `${fmtNum(group.toolCalls)} tools`,
  ].filter(Boolean);
  return parts.join(" · ");
}

function groupTable(groups: AnalysisGroup[]) {
  return {
    headers: ["Group", "Count", "Tokens", "API eq.", "Tool calls"],
    rows: groups.map((group) => ({
      id: group.key,
      cells: [group.label, fmtNumFull(group.count), group.tokens === null ? "—" : fmtNumFull(group.tokens), group.costUsd === null ? "—" : fmtUsd(group.costUsd), group.toolCalls === null ? "—" : fmtNumFull(group.toolCalls)],
    })),
  };
}

function timeBucketTable(buckets: AnalysisTimeBucket[]) {
  return {
    headers: ["Period", "Sessions", "Tokens", "API eq.", "Tool calls"],
    rows: buckets.map((bucket) => ({
      id: `${bucket.startMs}:${bucket.endMs}`,
      cells: [bucket.label, fmtNumFull(bucket.sessions), bucket.tokens === null ? "—" : fmtNumFull(bucket.tokens), bucket.costUsd === null ? "—" : fmtUsd(bucket.costUsd), bucket.toolCalls === null ? "—" : fmtNumFull(bucket.toolCalls)],
    })),
  };
}

function histogramTable(report: AnalysisReport, metric: DistributionMetric) {
  const histogram = metric === "tokens" ? report.tokenHistogram : report.durationHistogram;
  return {
    headers: ["Bin", "Sessions"],
    rows: histogram.bins.map((bin) => ({ id: `${bin.min}:${bin.max ?? "open"}`, cells: [binLabel(bin.min, bin.max, metric), fmtNumFull(bin.count)] })),
  };
}

function groupRows(groups: AnalysisGroup[], selection: ChartSelection, key: "source" | "model" | "tool", valueLabel: string, onSelect: (next: ChartSelection) => void) {
  const rows: AnalysisBar[] = groups.map((group) => ({
    id: group.key,
    label: group.label,
    value: group.count,
    detail: groupDetail(group) || "No additional metrics",
  }));
  return <SelectableBars
    rows={rows}
    format={fmtNum}
    selectedId={selection[key]}
    noun={valueLabel}
    onExplore={(id) => onSelect({ ...selection, [key]: id })}
  />;
}

function timeBucketsView(buckets: AnalysisTimeBucket[], selection: ChartSelection, onSelect: (next: ChartSelection) => void) {
  if (!buckets.length) return <p className="py-4 text-sm text-fg-muted">No dated sessions match this selection.</p>;
  return <TimeSeriesChart points={buckets.map(bucket => ({ id: `${bucket.startMs}:${bucket.endMs}`, at: bucket.startMs, label: bucket.label, values: [bucket.sessions], detail: `${new Date(bucket.startMs).toISOString()} – ${new Date(bucket.endMs).toISOString()} (exclusive)` }))} series={[{ label: "Sessions", color: "var(--color-accent)" }]} format={fmtNum} onExplore={id => {
    const bucket = buckets.find(b => `${b.startMs}:${b.endMs}` === id);
    if (bucket) onSelect({ ...selection, fromMs: Math.max(selection.fromMs ?? bucket.startMs, bucket.startMs), toMs: Math.min(selection.toMs ?? bucket.endMs, bucket.endMs) });
  }} />;
}

function Histogram({ report, metric, selection, onSelect }: { report: AnalysisReport; metric: DistributionMetric; selection: ChartSelection; onSelect: (next: ChartSelection) => void }) {
  const histogram = metric === "tokens" ? report.tokenHistogram : report.durationHistogram;
  const rows: AnalysisBar[] = histogram.bins.map((bin) => ({
    id: `${bin.min}:${bin.max ?? "open"}`,
    label: binLabel(bin.min, bin.max, metric),
    value: bin.count,
  }));
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2" role="group" aria-label="Distribution metric">
        {(["tokens", "duration"] as const).map((value) => (
          <button key={value} type="button" className="analysis-control" aria-pressed={metric === value} onClick={() => onSelect({ ...selection, metric: value, min: undefined, max: undefined })}>
            {value === "tokens" ? "Tokens" : "Duration"}
          </button>
        ))}
        <span className="text-[10px] text-fg-dim">{fmtNum(histogram.eligible)} eligible · {fmtNum(histogram.missing)} unavailable</span>
      </div>
      <SelectableBars
        rows={rows}
        format={fmtNum}
        selectedId={selection.metric === metric && selection.min !== undefined ? `${selection.min}:${selection.max ?? "open"}` : undefined}
        noun="sessions in this bin"
        onExplore={(id) => {
          const bin = histogram.bins.find((candidate) => `${candidate.min}:${candidate.max ?? "open"}` === id);
          if (!bin) return;
          const selected = selection.metric === metric && selection.min === bin.min && selection.max === bin.max;
          onSelect(selected ? { ...selection, metric: undefined, min: undefined, max: undefined } : { ...selection, metric, min: bin.min, max: bin.max });
        }}
      />
    </div>
  );
}

function SessionTable({ sessions, totalMatched, nextOffset, loading, onLoadMore }: {
  sessions: AnalysisSessionEvidence[];
  totalMatched: number;
  nextOffset: number | null;
  loading: boolean;
  onLoadMore: () => void;
}) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-fg-dim">
        <span>{fmtNumFull(sessions.length)} of {fmtNumFull(totalMatched)} matching sessions loaded</span>
        {nextOffset !== null && <span>Load more keeps the same snapshot generation.</span>}
      </div>
      <div className="analysis-table" role="region" tabIndex={0} aria-label="Matching collection sessions">
        <table className="w-full text-left text-xs">
          <thead><tr><th className="sticky left-0 z-[2] border-r border-bd-subtle" scope="col">Session</th><th scope="col">Model</th><th scope="col">Started</th><th scope="col" className="text-right">Tokens</th><th scope="col" className="text-right">Duration</th><th scope="col" className="text-right">Cost</th><th scope="col" className="text-right">Tools</th></tr></thead>
          <tbody>
            {!sessions.length && <tr><td colSpan={7} className="p-4 text-center text-fg-muted">No sessions match the current selection.</td></tr>}
            {sessions.map((session) => (
              <tr key={`${session.sourceId}:${session.sessionId}`}>
                <th scope="row" className="sticky left-0 z-[1] border-r border-bd-subtle bg-bg-subtle text-left font-normal">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <SessionEvidenceLink className="inline-flex max-w-[15rem] items-center gap-1 text-accent-soft hover:underline" href={`/collection/session?sourceId=${encodeURIComponent(session.sourceId)}&sessionId=${encodeURIComponent(session.sessionId)}`} title={`${session.sourceId} · ${session.sessionId}`}>
                      <span className="truncate">{session.sessionId}</span><ChevronRight className="size-3 shrink-0" aria-hidden="true" />
                    </SessionEvidenceLink>
                    <SessionEvidenceLink className="text-[10px] text-accent-soft hover:underline" href={`/collection/session?sourceId=${encodeURIComponent(session.sourceId)}&sessionId=${encodeURIComponent(session.sessionId)}`}>Inspect evidence</SessionEvidenceLink>
                  </div>
                  <span className="mt-1 block truncate text-[10px] text-fg-dim">{session.sourceId}{session.archived ? " · archived" : ""}{session.isSubagent ? " · child trace" : ""}</span>
                </th>
                <td className="mono text-fg-muted">{session.model}</td>
                <td className="whitespace-nowrap text-fg-muted">{fmtDateTime(session.startedAt)}</td>
                <td className="text-right mono tabular-nums">{nullable(session.tokens, fmtNum)}</td>
                <td className="text-right mono tabular-nums">{nullable(session.durationMs, fmtDuration)}</td>
                <td className="text-right mono tabular-nums" title={session.costSource}>{nullable(session.costUsd, fmtUsd)}{session.costUsd !== null && session.costSource === "inferred" ? " ~" : ""}</td>
                <td className="text-right mono tabular-nums">{nullable(session.toolCalls, fmtNum)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {nextOffset !== null && <button type="button" className="analysis-control mt-3" onClick={onLoadMore} disabled={loading}>{loading ? "Loading matching sessions…" : `Load more (${fmtNum(totalMatched - sessions.length)} remaining)`}</button>}
    </div>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value?: string | number; options: Array<{ value: string; label: string; count?: number }>; onChange: (value: string) => void }) {
  return (
    <label className="text-xs text-fg-muted">
      {label}
      <select className="analysis-input mt-1 block min-w-[8rem]" value={value === undefined ? "" : String(value)} onChange={(event) => onChange(event.target.value)}>
        <option value="">All</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}{option.count === undefined ? "" : ` (${fmtNum(option.count)})`}</option>)}
      </select>
    </label>
  );
}

export default function CollectionAnalysis() {
  const { selection, setSelection, ready: selectionReady, error: selectionError } = useChartSelection();
  const selectionKey = selectionParams(selection).toString();
  const selectionKeyRef = useRef(selectionKey);
  const requestVersion = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const reportRef = useRef<AnalysisReport | null>(null);
  const selectionRef = useRef(selection);
  selectionKeyRef.current = selectionKey;
  selectionRef.current = selection;
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchReport = useCallback(async (offset: number, append: boolean) => {
    const version = ++requestVersion.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (append) setPaging(true); else setLoading(true);
    if (!append) setNotice(null);
    try {
      const params = selectionParams(selectionRef.current);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      if (append && reportRef.current?.generation) params.set("generation", String(reportRef.current.generation));
      const response = await fetch(`/api/collection/analysis?${params.toString()}`, { cache: "no-store", signal: controller.signal });
      if (response.status === 409 && append) {
        // The snapshot changed while paging. Restart from offset zero against
        // the new generation instead of surfacing a generic HTTP error or
        // appending rows from two different populations.
        const restartParams = selectionParams(selectionRef.current);
        restartParams.set("limit", String(PAGE_SIZE));
        restartParams.set("offset", "0");
        const restartedResponse = await fetch(`/api/collection/analysis?${restartParams.toString()}`, { cache: "no-store", signal: controller.signal });
        if (!restartedResponse.ok) throw new Error(`Snapshot restart HTTP ${restartedResponse.status}`);
        const restarted = await restartedResponse.json() as AnalysisReport;
        if (version !== requestVersion.current || selectionKey !== selectionKeyRef.current) return;
        reportRef.current = restarted;
        setReport(restarted);
        setError(null);
        setNotice("The collection changed while paging; the matching-session list restarted from the current snapshot.");
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = await response.json() as AnalysisReport;
      if (version !== requestVersion.current || selectionKey !== selectionKeyRef.current) return;
      if (append && reportRef.current) {
        const appended = { ...reportRef.current, sessions: [...reportRef.current.sessions, ...next.sessions], nextOffset: next.nextOffset };
        reportRef.current = appended;
        setReport(appended);
      } else {
        reportRef.current = next;
        setReport(next);
      }
      setError(null);
    } catch (cause) {
      if (controller.signal.aborted || version !== requestVersion.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (version === requestVersion.current) {
        if (append) setPaging(false); else setLoading(false);
      }
    }
  }, [selectionKey]);

  useEffect(() => {
    if (!selectionReady || selectionError) return;
    reportRef.current = null;
    setReport(null);
    setError(null);
    setNotice(null);
    void fetchReport(0, false);
    return () => { abortRef.current?.abort(); requestVersion.current += 1; };
  }, [fetchReport, selectionError, selectionKey, selectionReady]);

  const select = useCallback((next: ChartSelection) => setSelection(next), [setSelection]);
  const histogramMetric: DistributionMetric = selection.metric ?? "tokens";
  const evidence = report?.evidence;
  const options = report?.options;
  const timeBuckets = report?.timeBuckets ?? [];
  const total = report?.usageTotals;
  const tokenComposition = [
    { key: "cacheRead", label: "Cache read", value: total?.cacheReadTokens ?? null, color: "color-mix(in srgb, var(--color-accent-soft) 45%, transparent)" },
    { key: "input", label: "Input", value: total?.inputTokens ?? null, color: "var(--color-accent)" },
    { key: "output", label: "Output", value: total?.outputTokens ?? null, color: "var(--color-ok)" },
    { key: "cacheCreate", label: "Cache create", value: total?.cacheCreateTokens ?? null, color: "var(--color-warn)" },
  ];
  const tokenCompositionTotal = tokenComposition.reduce((sum, segment) => sum + (segment.value ?? 0), 0);

  const weekdayOptions = useMemo(() => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, value) => ({ value: String(value), label })), []);
  const hourOptions = useMemo(() => Array.from({ length: 24 }, (_, value) => ({ value: String(value), label: `${String(value).padStart(2, "0")}:00` })), []);

  if (selectionError) return <div className="rounded-lg border border-err/30 bg-err/5 p-4 text-sm text-err" role="alert">{selectionError} <button type="button" className="analysis-control ml-2" onClick={() => setSelection({})}>Reset filters</button></div>;

  return (
    <div className="space-y-3" aria-busy={loading}>
      <section className="analysis-chart" aria-label="Collection analysis filters">
        <div className="analysis-chart__header">
          <div className="min-w-0"><h2 className="text-sm font-medium">Explore the full collection</h2><p className="mt-1 max-w-prose text-xs text-fg-muted">Filters and summaries use every matching parsed session. The table is a bounded page of the same snapshot and can load more without changing the evidence denominator.</p></div>
          <Link className="analysis-control" href={chartSelectionHref("/collection/timeline", selection)}>Open matching Timeline <ChevronRight className="size-3.5" aria-hidden="true" /></Link>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <DateRangeControls selection={selection} onChange={select} />
          <FilterSelect label="Source" value={selection.source} options={(options?.sources ?? []).map((option) => ({ ...option }))} onChange={(value) => select({ ...selection, source: value || undefined })} />
          <FilterSelect label="Model" value={selection.model} options={(options?.models ?? []).map((option) => ({ ...option }))} onChange={(value) => select({ ...selection, model: value || undefined })} />
          <FilterSelect label="Tool" value={selection.tool} options={(options?.tools ?? []).map((option) => ({ ...option }))} onChange={(value) => select({ ...selection, tool: value || undefined })} />
          <FilterSelect label="Weekday · local" value={selection.weekday} options={weekdayOptions} onChange={(value) => select({ ...selection, weekday: value === "" ? undefined : Number(value) })} />
          <FilterSelect label="Hour · local" value={selection.hour} options={hourOptions} onChange={(value) => select({ ...selection, hour: value === "" ? undefined : Number(value) })} />
        </div>
        <div className="mt-3"><SelectionChips selection={selection} onChange={select} /></div>
        {loading && <p className="mt-3 flex items-center gap-2 text-xs text-fg-muted" role="status"><Loader2 className="size-3.5 animate-spin" /> Updating the selected snapshot…</p>}
        {notice && <p className="mt-3 text-xs text-warn" role="status">{notice}</p>}
        <SavedAnalysisViews selection={selection} />
        {error && <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-err/30 bg-err/5 p-3 text-xs text-err" role="alert"><AlertTriangle className="size-3.5 shrink-0" /> Collection analysis unavailable: {error}<button type="button" className="analysis-control" onClick={() => void fetchReport(0, false)}><RefreshCw className="size-3" /> Retry</button></div>}
      </section>

      {report && !error && <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="card p-3"><div className="text-[10px] uppercase tracking-[0.12em] text-fg-dim">Matching sessions</div><div className="mt-1 text-xl font-semibold mono tabular-nums">{fmtNum(report.totalMatched)}</div><div className="mt-1 text-[10px] text-fg-dim">of {fmtNum(report.population)} parsed</div></div>
          <div className="card p-3"><div className="text-[10px] uppercase tracking-[0.12em] text-fg-dim">Tokens</div><div className="mt-1 text-xl font-semibold mono tabular-nums">{nullable(total?.tokens ?? null, fmtNum)}</div><div className="mt-1 text-[10px] text-fg-dim">{fmtNum(total?.tokenSessions ?? 0)} sessions with evidence</div></div>
          <div className="card p-3"><div className="text-[10px] uppercase tracking-[0.12em] text-fg-dim">API equivalent</div><div className="mt-1 text-xl font-semibold mono tabular-nums">{nullable(total?.costUsd ?? null, fmtUsd)}</div><div className="mt-1 text-[10px] text-fg-dim">{fmtNum(total?.measuredCostSessions ?? 0)} recorded · {fmtNum(total?.inferredCostSessions ?? 0)} inferred</div></div>
          <div className="card p-3"><div className="text-[10px] uppercase tracking-[0.12em] text-fg-dim">Tool calls</div><div className="mt-1 text-xl font-semibold mono tabular-nums">{nullable(total?.toolCalls ?? null, fmtNum)}</div><div className="mt-1 text-[10px] text-fg-dim">{nullable(total?.toolErrors ?? null, fmtNum)} reported errors</div></div>
        </div>

        <details className="card overflow-hidden">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
            <span>Token composition</span>
            <span className="text-[10px] font-normal text-fg-dim">{tokenCompositionTotal > 0 ? `${fmtNum(tokenCompositionTotal)} reported classes` : "unavailable"} · expand</span>
          </summary>
          <div className="border-t border-bd-subtle px-4 py-3">
            {tokenCompositionTotal > 0 ? (
              <>
                <div className="flex h-4 overflow-hidden rounded-full bg-bg-elev" role="img" aria-label={`Token composition: ${tokenComposition.map((segment) => `${segment.label} ${fmtNum(segment.value ?? 0)}`).join(", ")}`}>
                  {tokenComposition.map((segment) => <span key={segment.key} className="h-full" style={{ width: `${((segment.value ?? 0) / tokenCompositionTotal) * 100}%`, background: segment.color }} title={`${segment.label}: ${fmtNumFull(segment.value ?? 0)}`} />)}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-fg-dim sm:grid-cols-4">
                  {tokenComposition.map((segment) => <span key={segment.key} className="inline-flex items-center gap-1"><span aria-hidden="true" className="size-2 rounded-[2px]" style={{ background: segment.color }} />{segment.label} <span className="mono tabular-nums">{segment.value === null ? "—" : fmtNum(segment.value)}</span></span>)}
                </div>
                <p className="mt-3 text-[10px] leading-relaxed text-fg-dim">Cache reads and cache creates remain separate from input and output. Missing classes are unavailable evidence, not zero usage.</p>
              </>
            ) : <p className="text-xs text-fg-dim">No token-class composition is available for the current selection.</p>}
          </div>
        </details>

        <details className="analysis-chart overflow-hidden">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
            <span>Detailed breakdowns</span>
            <span className="text-[10px] font-normal text-fg-dim">grouped charts, periods, and distributions · expand</span>
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <ChartFrame title="By source" description="Inspect a source, then explicitly explore its matching sessions." evidence={evidence} table={groupTable(report.sourceGroups)}>
            {groupRows(report.sourceGroups, selection, "source", "matching sessions", select)}
          </ChartFrame>
          <ChartFrame title="By primary model" description="Whole sessions grouped by their primary model. Model filters include secondary models too; usage here is not apportioned per model. Explore includes secondary appearances." evidence={evidence} table={groupTable(report.modelGroups)}>
            {groupRows(report.modelGroups, selection, "model", "all sessions containing this model", select)}
          </ChartFrame>
          <ChartFrame title="By tool" description="Counts represent tool calls; a session can contribute to several tools." evidence={evidence} table={groupTable(report.toolGroups)}>
            {groupRows(report.toolGroups, selection, "tool", "tool calls", select)}
          </ChartFrame>
          <ChartFrame title="Session volume by period" description="Buckets are local calendar days in the runtime timezone; selecting one applies its exclusive timestamp range to the full report." evidence={evidence} table={timeBucketTable(timeBuckets)}>
            {timeBucketsView(timeBuckets, selection, select)}
          </ChartFrame>
          <ChartFrame title="Metric distribution" description="Select a bin to inspect the matching sessions. Missing values remain unavailable rather than zero." evidence={evidence} table={histogramTable(report, histogramMetric)} className="lg:col-span-2">
            <Histogram report={report} metric={histogramMetric} selection={selection} onSelect={select} />
          </ChartFrame>
          </div>
        </details>

        <ChartFrame title="Matching sessions" description="Source and session identifiers are the redaction-safe handoff to transcript evidence." evidence={evidence}>
          <SessionTable sessions={report.sessions} totalMatched={report.totalMatched} nextOffset={report.nextOffset} loading={paging} onLoadMore={() => void fetchReport(report.nextOffset ?? 0, true)} />
        </ChartFrame>
      </>}
    </div>
  );
}
