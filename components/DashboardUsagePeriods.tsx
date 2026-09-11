"use client";
import { useEffect, useState } from "react";
import type { AnalysisReport } from "@/lib/collection/analysis";
import { ChartFrame } from "./charts/ChartFrame";
import { SelectableBars } from "./charts/SelectableBars";
import { chartSelectionHref } from "@/lib/chart-analysis";

export function DashboardUsagePeriods() {
  const [report, setReport] = useState<AnalysisReport | null>(null), [error, setError] = useState("");
  useEffect(() => { const controller = new AbortController(); fetch("/api/collection/analysis?limit=1", { signal: controller.signal }).then(async response => { if (!response.ok) throw new Error("Usage history could not be loaded."); return response.json(); }).then(setReport).catch(reason => { if (reason.name !== "AbortError") setError(reason.message); }); return () => controller.abort(); }, []);
  if (!report) return <p className="text-xs text-fg-muted mb-5" role="status">{error || "Loading session volume and cost history…"}</p>;
  const buckets = report.timeBuckets.slice(-14);
  return <section className="grid md:grid-cols-2 gap-4 mb-6" aria-label="Recent usage periods">{(["sessions", "costUsd"] as const).map(metric => <ChartFrame key={metric} title={metric === "sessions" ? "Session volume" : "Available cost"} description={`Latest ${buckets.length} available calendar buckets. Full matched history has ${report.totalMatched} sessions; these totals are independent of outcome scores.`} evidence={{ ...report.evidence, population: report.timeBuckets.length, eligible: buckets.filter(bucket => bucket[metric] !== null).length, plotted: undefined, scope: "calendar buckets · latest 14 selected" }} unit={metric === "sessions" ? "Sessions" : "USD · available measured and inferred costs; coverage below"} table={{ headers: ["Period", metric === "sessions" ? "Sessions" : "USD"], rows: buckets.map(bucket => ({ id: String(bucket.startMs), cells: [bucket.label, bucket[metric] ?? "Unavailable"] })) }}>
    <SelectableBars rows={buckets.filter(bucket => bucket[metric] !== null).map(bucket => ({ id: String(bucket.startMs), label: bucket.label, value: bucket[metric]!, detail: `${bucket.sessions} sessions` }))} format={value => metric === "costUsd" ? `$${value.toFixed(2)}` : String(value)} noun="sessions" onExplore={id => { const bucket = buckets.find(item => String(item.startMs) === id); if (bucket) window.location.assign(chartSelectionHref("/collection", { fromMs: bucket.startMs, toMs: bucket.endMs })); }} />
    {metric === "costUsd" && <p className="text-xs text-fg-muted mt-3">Full history cost coverage: {report.usageTotals.measuredCostSessions} measured · {report.usageTotals.inferredCostSessions} inferred · {report.totalMatched - report.usageTotals.measuredCostSessions - report.usageTotals.inferredCostSessions} unavailable. Period totals can be incomplete.</p>}
  </ChartFrame>)}</section>;
}
