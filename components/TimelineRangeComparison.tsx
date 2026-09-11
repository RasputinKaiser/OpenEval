"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { TimelineReport } from "@/lib/insights/collect";
import { chartSelectionHref, dateRangeWithinSelection, selectionParams, type ChartSelection } from "@/lib/chart-analysis";
import { DateRangeControls } from "./charts/SelectionControls";
import { ChartFrame } from "./charts/ChartFrame";

type RangeReport = TimelineReport & { generatedAtMs?: number; stale?: boolean; refreshing?: boolean; refreshError?: string };

export function TimelineRangeComparison({ selection, dateStart, dateEnd }: { selection: ChartSelection; dateStart: number | null; dateEnd: number | null }) {
  const [open, setOpen] = useState(false);
  const [before, setBefore] = useState<ChartSelection>({});
  const [after, setAfter] = useState<ChartSelection>({});
  const [reports, setReports] = useState<[RangeReport, RangeReport] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const key = selectionParams(selection).toString();
  useEffect(() => {
    const restore = () => {
      const from = selection.fromMs ?? dateStart;
      const to = selection.toMs ?? (dateEnd === null ? null : dateEnd + 1);
      if (from === null || to === null || to <= from) return;
      const midpoint = Math.floor((from + to) / 2);
      const params = new URLSearchParams(window.location.search);
      const read = (prefix: string, fallback: ChartSelection): ChartSelection => {
        const lo = params.get(`${prefix}From`), hi = params.get(`${prefix}To`);
        if (lo === null && hi === null) return fallback;
        const fromMs = lo === null ? undefined : Number(lo), toMs = hi === null ? undefined : Number(hi);
        if ((fromMs !== undefined && (!Number.isInteger(fromMs) || fromMs < 0 || fromMs > 8.64e15)) || (toMs !== undefined && (!Number.isInteger(toMs) || toMs < 0 || toMs > 8.64e15)) || (fromMs !== undefined && toMs !== undefined && fromMs >= toMs)) return fallback;
        return { fromMs, toMs };
      };
      setBefore(read("compareBefore", { fromMs: from, toMs: midpoint }));
      setAfter(read("compareAfter", { fromMs: midpoint, toMs: to }));
      if (params.has("compareBeforeFrom") || params.has("compareAfterFrom")) setOpen(true);
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [key, selection.fromMs, selection.toMs, dateStart, dateEnd]);
  const applyRange = (prefix: "compareBefore" | "compareAfter", value: ChartSelection) => {
    const url = new URL(window.location.href);
    for (const [suffix, bound] of [["From", value.fromMs], ["To", value.toMs]] as const) {
      if (bound === undefined) url.searchParams.delete(`${prefix}${suffix}`);
      else url.searchParams.set(`${prefix}${suffix}`, String(bound));
    }
    window.history.pushState(window.history.state, "", url);
    if (prefix === "compareBefore") setBefore(value); else setAfter(value);
  };
  const beforeKey = selectionParams({ ...selection, ...before }).toString();
  const afterKey = selectionParams({ ...selection, ...after }).toString();
  const withinSelection = dateRangeWithinSelection(before, selection) && dateRangeWithinSelection(after, selection);
  const valid = withinSelection && before.toMs !== undefined && after.fromMs !== undefined && before.toMs <= after.fromMs && (before.fromMs === undefined || before.fromMs < before.toMs) && (after.toMs === undefined || after.fromMs < after.toMs);
  useEffect(() => {
    if (!open || !valid) { setReports(null); setLoading(false); setError(null); return; }
    const controller = new AbortController();
    setLoading(true); setError(null); setReports(null);
    void Promise.all([beforeKey, afterKey].map(async (params) => {
      const response = await fetch(`/api/collection/timeline?${params}`, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error(`Comparison unavailable (HTTP ${response.status}).`);
      return response.json() as Promise<RangeReport>;
    })).then((values) => { if (!controller.signal.aborted) { if (values[0].generatedAtMs !== values[1].generatedAtMs) throw new Error("The collection changed between periods. Retry for a consistent snapshot."); setReports(values as [RangeReport, RangeReport]); } })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, valid, beforeKey, afterKey, retry]);
  const sameInstrument = reports && reports[0].overall.outcomeProvenance === reports[1].overall.outcomeProvenance && ["judged", "heuristic"].includes(reports[0].overall.outcomeProvenance ?? "");
  const judgeInstrument = (report: RangeReport) => {
    const instrument = report.judgeSelectionDistribution?.[0];
    return report.judgeComparability?.homogeneous && report.judgeComparability.staleReceiptCount === 0 && report.judgeSelectionDistribution?.length === 1 && instrument
      ? JSON.stringify([instrument.source, instrument.model, instrument.reasoningEffort, instrument.promptVersion]) : null;
  };
  const matchingJudge = reports && (reports[0].overall.outcomeProvenance !== "judged" || (judgeInstrument(reports[0]) !== null && judgeInstrument(reports[0]) === judgeInstrument(reports[1])));
  const enough = reports?.every((report) => report.overall.comparable && (report.overall.firstHalfN ?? 0) >= 5 && (report.overall.secondHalfN ?? 0) >= 5);
  return <div className="mb-4">
    <button type="button" className="analysis-control" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Close range comparison" : "Compare explicit before / after ranges"}</button>
    {open && <ChartFrame title="Before / after evidence" description="Choose non-overlapping UTC periods within the active date and source/model selection. Changes are descriptive; workload and instrumentation can change between periods." unit="Outcome values are each period’s first-half and second-half medians; missing signal is excluded.">
      <div className="grid gap-4 lg:grid-cols-2"><div><h3 className="text-sm mb-2">Before</h3><DateRangeControls selection={before} onChange={(value) => applyRange("compareBefore", value)} /></div><div><h3 className="text-sm mb-2">After</h3><DateRangeControls selection={after} onChange={(value) => applyRange("compareAfter", value)} /></div></div>
      {!valid && <p role="alert" className="text-xs text-warn mt-3">{!withinSelection ? "Saved comparison periods extend beyond the active date selection. Adjust their dates to stay within that selection." : "Set an end for Before and a start for After. Each period must have a positive span, and the periods must not overlap."}</p>}
      {loading && <p role="status" className="text-xs text-fg-muted mt-3">Loading both periods…</p>}
      {error && <p role="alert" className="text-xs text-err mt-3">{error} <button type="button" className="analysis-control" onClick={() => setRetry(retry + 1)}>Retry comparison</button></p>}
      {reports && <>{reports.some((report) => report.stale || report.refreshing || report.refreshError) && <p className="text-xs text-warn mt-3">These periods use a retained snapshot while collection refresh is incomplete.</p>}<p className="mt-3 text-xs text-fg-muted">{sameInstrument && matchingJudge && enough ? "Both periods have matching outcome provenance and judge configuration where applicable, with at least five observations per half. Workload differences may still explain changes." : "Outcome comparison is limited by thin or differing evidence. Values remain separate; no pooled outcome delta is asserted."}</p><div className="analysis-table mt-3" role="region" tabIndex={0} aria-label="Before and after evidence comparison"><table className="w-full text-xs text-left"><thead><tr><th>Period</th><th>Top-level sessions</th><th>Signal / total</th><th>Judged / total</th><th>First-half median (n)</th><th>Second-half median (n)</th><th>Outcome evidence</th><th>Inspect</th></tr></thead><tbody>{reports.map((report, index) => <tr key={index}><td>{index === 0 ? "Before" : "After"}</td><td>{report.totalSessions}</td><td>{report.signalSessions} / {report.totalSessions}</td><td>{report.judgedSessions} / {report.totalSessions}</td><td>{report.overall.firstHalfN ? `${report.overall.firstHalfOutcome} (${report.overall.firstHalfN})` : "Unavailable"}</td><td>{report.overall.secondHalfN ? `${report.overall.secondHalfOutcome} (${report.overall.secondHalfN})` : "Unavailable"}</td><td>{report.overall.outcomeProvenance ?? "Unavailable"}</td><td><Link className="text-accent-soft underline" href={chartSelectionHref("/collection/timeline", { ...selection, ...(index === 0 ? before : after) })}>Explore period</Link></td></tr>)}</tbody></table></div></>}
    </ChartFrame>}
  </div>;
}
