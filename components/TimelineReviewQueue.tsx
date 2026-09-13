"use client";
import { useEffect, useRef, useState } from "react";
import type { ChartSelection } from "@/lib/chart-analysis";
import type { JudgeSelectionInput } from "@/lib/grader/selection";
import type { JudgeQueueFilters, JudgeQueuePreview, JudgeReviewReason } from "@/lib/insights/judge-queue";

export function TimelineReviewQueue({ selection, method, disabled, running, onRun }: { selection: ChartSelection; method: JudgeSelectionInput; disabled: boolean; running: boolean; onRun: (filters: JudgeQueueFilters) => Promise<void> }) {
  const [reason, setReason] = useState("all"), [limit, setLimit] = useState(10);
  const [previewKey, setPreviewKey] = useState("");
  const [preview, setPreview] = useState<JudgeQueuePreview | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const filters: JudgeQueueFilters = { from: selection.fromMs, to: selection.toMs, source: selection.source, model: selection.model, limit, ...(reason === "all" ? {} : { reasons: [reason as JudgeReviewReason] }) };
  const key = JSON.stringify({ filters, method });
  const currentKey = useRef(key); currentKey.current = key;
  const validPreview = previewKey === key ? preview : null;
  useEffect(() => { setPreview(null); setError(""); }, [key]);
  async function inspect() {
    setLoading(true); setError(""); setPreview(null);
    try {
      const response = await fetch("/api/collection/timeline/judge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preview: true, filters, selection: method }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Review queue unavailable."); if (currentKey.current === key) { setPreview(body); setPreviewKey(key); }
    } catch (cause) { if (currentKey.current === key) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }
  return <div className="space-y-3">
    <p className="text-xs text-fg-muted">Review the selected date range, source, and model. Previewing the queue does not invoke a model.</p>
    {Object.keys(selection).some(key => !["fromMs", "toMs", "source", "model"].includes(key) && selection[key as keyof ChartSelection] !== undefined) && <p className="text-xs text-warn">Other chart filters do not apply to this review queue.</p>}
    <div className="grid grid-cols-2 gap-2"><label className="text-xs">Review reason<select aria-label="Review queue reason" className="analysis-input block w-full mt-1" value={reason} onChange={event => setReason(event.target.value)}>{[["all", "All, balanced"], ["gap", "Missing reviews"], ["uncertain", "Uncertain evidence"], ["disagreement", "Disagreement"], ["changed", "Changed evidence"], ["balanced", "Routine coverage"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-xs">Session budget<select aria-label="Review session budget" className="analysis-input block w-full mt-1" value={limit} onChange={event => setLimit(Number(event.target.value))}>{[1, 5, 10, 25, 50].map(value => <option key={value} value={value}>{value} maximum</option>)}</select></label></div>
    <button className="analysis-control w-full" disabled={loading || running} onClick={inspect}>{loading ? "Preparing preview…" : "Preview review queue"}</button>
    {error && <p role="alert" className="text-xs text-warn">{error}</p>}
    {validPreview && <div className="text-xs space-y-2" role="status"><p>{validPreview.returned} of {validPreview.total} eligible sessions · serial execution · maximum {limit} model calls.</p><p className="text-fg-muted">{Object.entries(validPreview.counts).map(([label, count]) => `${label}: ${count}`).join(" · ")}</p><details><summary className="cursor-pointer">Inspect selected sessions</summary><ol className="mt-2 max-h-40 overflow-auto space-y-2">{validPreview.items.map(item => <li className="break-words" key={`${item.sourceId}:${item.sessionId}`}>{item.sourceId} · {item.sessionId}<span className="block text-fg-muted">{item.model ?? "Unknown model"} · {item.reasons.join(", ")}</span></li>)}</ol></details><p className="text-fg-muted">Bounded packets retain requests, errors, recovery, and recent output. Insufficient evidence remains unscored. Eligibility is checked again when review starts.</p></div>}
    <button className="analysis-control w-full" disabled={disabled || !validPreview?.returned || loading} onClick={async () => { await onRun(filters); setPreview(null); }}>{running ? "Reviewing…" : `Review up to ${limit} sessions`}</button>
    <p className="text-[10px] text-fg-dim">Starting review invokes the selected backend and consumes its usage. No live model accuracy is implied by the synthetic validation fixtures.</p>
  </div>;
}
