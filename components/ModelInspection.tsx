"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRedactedShow } from "@/lib/use-redaction";
import { requestJson } from "@/lib/client-request";
import { chartSelectionHref, selectionParams, type ChartSelection } from "@/lib/chart-analysis";
import type { AnalysisReport } from "@/lib/collection/analysis";
import { ChartFrame } from "./charts/ChartFrame";
import { TimeSeriesChart } from "./charts/TimeSeriesChart";
import { fmtNum } from "@/lib/format";

export default function ModelInspection({ model, onClose, onExplore }: { model: string; onClose: () => void; onExplore: (selection: ChartSelection) => void }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { panel.current?.scrollIntoView({ block: "start", behavior: "auto" }); }, [model]);
  const { show } = useRedactedShow([model]);
  const [report, setReport] = useState<AnalysisReport | null>(null), [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setReport(null); setError("");
    const params = selectionParams({ model }); params.set("limit", "5");
    void requestJson<AnalysisReport>(`/api/collection/analysis?${params}`, { signal: controller.signal, message: "Model evidence could not be loaded." }).then(value => { if (!controller.signal.aborted) setReport(value); }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [model, retry]);
  return <section ref={panel} className="model-inspection p-4 border-b border-bd space-y-3" aria-label={`Inspect model ${show(model)}`} onKeyDown={e => { if (e.key === "Escape") onClose(); }}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-base font-semibold break-all">{show(model)}</h3><button className="analysis-control" onClick={onClose}>Close inspection</button></div>
    <p className="text-xs text-fg-muted">Sessions containing this model, including mixed-model sessions. Coverage describes whole sessions. Select a period to explore a narrower date range.</p>
    {error ? <p role="alert" className="text-sm text-err">{error} <button className="analysis-control" onClick={() => setRetry(v => v + 1)}>Retry</button></p> : !report ? <p role="status" className="text-sm text-fg-muted">Loading model activity and sources…</p> : <>
      <ChartFrame title="Model activity" evidence={report.evidence} table={{ headers: ["Period", "Sessions"], rows: report.timeBuckets.map(b => ({ id: String(b.startMs), cells: [b.label, b.sessions] })) }}>
        <TimeSeriesChart points={report.timeBuckets.map(b => ({ id: String(b.startMs), at: b.startMs, label: b.label, values: [b.sessions] }))} series={[{ label: "Sessions", color: "var(--color-accent-soft)" }]} format={fmtNum} onExplore={id => { const b = report.timeBuckets.find(b => String(b.startMs) === id); if (b) onExplore({ model, fromMs: b.startMs, toMs: b.endMs }); }} />
      </ChartFrame>
      <div className="flex flex-wrap gap-2" aria-label="Contributing sources">{report.sourceGroups.map(source => <button key={source.key} className="analysis-control" onClick={() => onExplore({ model, source: source.key })}>{source.label} · {fmtNum(source.sessions)} sessions</button>)}</div>
      <p className="text-xs text-fg-muted">{fmtNum(report.totalMatched)} matching sessions · cost coverage: {report.usageTotals.measuredCostSessions} provider-reported, {report.usageTotals.inferredCostSessions} estimated, {report.totalMatched - report.usageTotals.measuredCostSessions - report.usageTotals.inferredCostSessions} unavailable.</p>
      <button className="analysis-control" onClick={() => onExplore({ model })}>Explore all matching sessions</button>
      <details><summary className="text-sm text-accent-soft cursor-pointer min-h-10">Recent matching session references</summary><ul className="space-y-2 text-xs">{report.sessions.map(session => <li key={`${session.sourceId}:${session.sessionId}`}><Link className="underline break-all" href={`${chartSelectionHref('/collection/session', { model })}&sourceId=${encodeURIComponent(session.sourceId)}&sessionId=${encodeURIComponent(session.sessionId)}&returnTo=%2Fcollection`}>{session.sourceId} · {session.sessionId}</Link></li>)}</ul></details>
    </>}
  </section>;
}
