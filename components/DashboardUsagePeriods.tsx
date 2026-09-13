"use client";
import { useEffect, useState } from "react";
import { requestJson } from "@/lib/client-request";
import type { AnalysisReport } from "@/lib/collection/analysis";
import { ChartFrame } from "./charts/ChartFrame";
import { SelectableBars } from "./charts/SelectableBars";
import { TimeSeriesChart } from "./charts/TimeSeriesChart";
import { DateRangeControls, SelectionChips } from "./charts/SelectionControls";
import { useChartSelection } from "@/lib/use-chart-selection";
import { chartSelectionHref, selectionParams } from "@/lib/chart-analysis";
import { fmtNum } from "@/lib/format";

export function DashboardUsagePeriods() {
  const { selection, setSelection, ready } = useChartSelection();
  const [report, setReport] = useState<AnalysisReport | null>(null), [error, setError] = useState("");
  const [retry, setRetry] = useState(0), [loading, setLoading] = useState(false);
  const [group, setGroup] = useState<"model" | "source">("model");
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController(); setLoading(true); setError("");
    const params = selectionParams(selection); params.set("limit", "1");
    requestJson<AnalysisReport>(`/api/collection/analysis?${params}`, { signal: controller.signal, message: "Usage history could not be loaded." }).then(value => { if (!controller.signal.aborted) setReport(value); }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selection, ready, retry]);
  const buckets = report?.timeBuckets ?? [];
  const explore = (id: string) => { const bucket = buckets.find(item => String(item.startMs) === id); if (bucket) window.location.assign(chartSelectionHref("/collection", { ...selection, fromMs: Math.max(selection.fromMs ?? bucket.startMs, bucket.startMs), toMs: Math.min(selection.toMs ?? bucket.endMs, bucket.endMs) })); };
  return <section className="mb-6 space-y-3" aria-label="Usage and activity">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">Usage and activity</h2><DateRangeControls selection={selection} onChange={setSelection} /></div>
    <SelectionChips selection={selection} onChange={setSelection} />
    {loading && <p role="status" className="text-xs text-fg-muted">Updating this range…</p>}
    {error && <p role="alert" className="text-sm text-err">{error} <button className="analysis-control" onClick={() => setRetry(v => v + 1)}>Retry</button></p>}
    {report && !loading && !error && <div className="grid lg:grid-cols-2 gap-4">
      <ChartFrame title="Session activity" description={`${report.totalMatched} matching sessions. Inspect a period, then explore the conversations behind it.`} unit="Sessions · bounded chronological periods" evidence={report.evidence} table={{ headers: ["Period", "Sessions"], rows: buckets.map(b => ({ id: String(b.startMs), cells: [b.label, b.sessions] })) }}>
        <TimeSeriesChart points={buckets.map(b => ({ id: String(b.startMs), at: b.startMs, label: b.label, values: [b.sessions], detail: `${new Date(b.startMs).toISOString()} to ${new Date(b.endMs).toISOString()} (exclusive)` }))} series={[{ label: "Sessions", color: "var(--color-accent)" }]} format={fmtNum} onExplore={explore} />
      </ChartFrame>
      <ChartFrame title="Token composition" description="Recorded input, output, cache reads and cache writes. Gaps mean unavailable usage; these are not subscription credits." evidence={report.evidence} unit="Tokens" table={{ headers: ["Period", "Input", "Output", "Cache read", "Cache write"], rows: buckets.map(b => ({ id: String(b.startMs), cells: [b.label, b.inputTokens ?? "Unavailable", b.outputTokens ?? "Unavailable", b.cacheReadTokens ?? "Unavailable", b.cacheCreateTokens ?? "Unavailable"] })) }}>
        <TimeSeriesChart stacked points={buckets.map(b => ({ id: String(b.startMs), at: b.startMs, label: b.label, values: [b.inputTokens, b.outputTokens, b.cacheReadTokens, b.cacheCreateTokens], detail: `${b.sessions} sessions` }))} series={[{ label: "Input", color: "var(--color-accent)" }, { label: "Output", color: "var(--color-ok)" }, { label: "Cache reads", color: "var(--color-warn)" }, { label: "Cache writes", color: "var(--color-fg-muted)" }]} format={fmtNum} onExplore={explore} />
        <p className="mt-3 text-xs text-fg-muted">{report.usageTotals.tokenSessions} / {report.totalMatched} sessions have token evidence.</p>
      </ChartFrame>
      <ChartFrame title="Available cost" description="Provider-reported and estimated API-equivalent costs remain separate from subscription spend." evidence={report.evidence} table={{ headers: ["Period", "Measured USD", "Estimated USD"], rows: buckets.map(b => ({ id: String(b.startMs), cells: [b.label, b.measuredCostUsd ?? "Unavailable", b.inferredCostUsd ?? "Unavailable"] })) }}>
        <TimeSeriesChart points={buckets.map(b => ({ id: String(b.startMs), at: b.startMs, label: b.label, values: [b.measuredCostUsd ?? null, b.inferredCostUsd ?? null], detail: "Estimates are API-equivalent, not provider spend" }))} series={[{ label: "Provider-reported USD", color: "var(--color-ok)" }, { label: "Estimated USD", color: "var(--color-warn)" }]} format={v => `$${fmtNum(v)}`} onExplore={explore} />
        <p className="text-xs text-fg-muted mt-3">Cost coverage: {report.usageTotals.measuredCostSessions} provider-reported · {report.usageTotals.inferredCostSessions} estimated · {report.totalMatched - report.usageTotals.measuredCostSessions - report.usageTotals.inferredCostSessions} unavailable.</p>
      </ChartFrame>
      <ChartFrame title="Activity breakdown" description="Inspect a model or source to narrow the same evidence population." evidence={report.evidence}>
        <div role="group" aria-label="Activity grouping" className="flex gap-2 mb-3">{(["model", "source"] as const).map(value => <button className="analysis-control" key={value} aria-pressed={group === value} onClick={() => setGroup(value)}>By {value}</button>)}</div>
        <SelectableBars rows={(group === "model" ? report.modelGroups : report.sourceGroups).map(g => ({ id: g.key, label: g.label, value: g.count, detail: g.tokens === null ? "Tokens unavailable" : `${fmtNum(g.tokens)} tokens` }))} selectedId={selection[group]} format={fmtNum} onExplore={id => setSelection({ ...selection, [group]: id })} />
      </ChartFrame>
    </div>}
  </section>;
}
