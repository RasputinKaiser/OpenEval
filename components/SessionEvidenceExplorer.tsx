"use client";
import { useEffect, useMemo, useState } from "react";
import type { EvidencePacket } from "@/lib/insights/evidence";
import type { AnalysisReport, AnalysisSessionEvidence } from "@/lib/collection/analysis";
import { selectionParams, type ChartSelection } from "@/lib/chart-analysis";
import { useRedactedShow } from "@/lib/use-redaction";
import { EvidenceEventLanes } from "./EvidenceEventLanes";
import { RedactToggle } from "./RedactToggle";

interface EvidenceReceipt {
  receiptId: string; outcome: string; score: number | null; confidence: string; reasons: string[];
  evidenceIds: string[]; contradictionEvidenceIds: string[]; dimensions?: Record<string, unknown>;
  selection?: { source: string; model: string; reasoningEffort?: string | null }; createdAt: number;
  promptVersion: number; evidenceVersion: string; evidenceMatches: boolean; promptMatches: boolean;
}
export function SessionEvidenceExplorer({ selection }: { selection: ChartSelection }) {
  const [sessions, setSessions] = useState<AnalysisSessionEvidence[]>([]), [matched, setMatched] = useState(0), [chosen, setChosen] = useState("");
  const [packet, setPacket] = useState<EvidencePacket | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [receipts, setReceipts] = useState<EvidenceReceipt[]>([]);
  const [sequenceIds, setSequenceIds] = useState<string[] | null>(null);
  const [episode, setEpisode] = useState(""), [recordKind, setRecordKind] = useState("all");
  const query = selectionParams({ ...selection, outcome: undefined }).toString();
  useEffect(() => {
    const controller = new AbortController(); setPacket(null); setChosen(""); setLoading(false); setSessions([]); setMatched(0); setReceipts([]); setError("");
    fetch(`/api/collection/analysis?${query}&limit=80`, { signal: controller.signal }).then(async response => { if (!response.ok) throw new Error("Session selection is unavailable."); return response.json() as Promise<AnalysisReport>; }).then(report => { setSessions(report.sessions); setMatched(report.totalMatched); }).catch(reason => { if (reason.name !== "AbortError") setError(reason.message); });
    return () => controller.abort();
  }, [query]);
  useEffect(() => {
    if (!chosen) { setPacket(null); return; }
    const controller = new AbortController(); const [sourceId, sessionId] = JSON.parse(chosen) as [string, string];
    setLoading(true); setReceipts([]); setPacket(null); setError(""); setEpisode(""); setRecordKind("all"); setSequenceIds(null);
    fetch(`/api/collection/evidence?${new URLSearchParams({ sourceId, sessionId })}`, { signal: controller.signal }).then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Evidence is unavailable."); return body as { packet: EvidencePacket; receipts: EvidenceReceipt[] }; }).then(body => { setPacket(body.packet); setReceipts(body.receipts ?? []); }).catch(reason => { if (reason.name !== "AbortError") setError(reason.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [chosen]);
  const excerpts = useMemo(() => [...(packet?.records.map(record => record.excerpt) ?? []), ...receipts.flatMap(receipt => receipt.reasons)], [packet, receipts]);
  const { redact, setRedact, show } = useRedactedShow(excerpts, { secrets: true });
  const selectedEpisode = packet?.episodes.find(item => item.episodeId === episode);
  const records = packet?.records.filter(record => (!sequenceIds || sequenceIds.includes(record.evidenceId)) && (!selectedEpisode || selectedEpisode.evidenceIds.includes(record.evidenceId)) && (recordKind === "all" || (recordKind === "claims" ? record.claimed : record.kind === recordKind))) ?? [];
  return <section className="card p-4 sm:p-5 mb-5" aria-labelledby="session-evidence-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-medium" id="session-evidence-title">Session evidence lab</h2><p className="text-xs text-fg-muted mt-1">Inspect observed receipts, task boundaries, and unknowns before reviewing an outcome.</p></div><RedactToggle redact={redact} onToggle={() => setRedact(!redact)} /></div>
    <label className="text-xs block mt-3">Session in the current selection<select aria-label="Session evidence selection" className="analysis-input block w-full mt-1" value={chosen} onChange={event => setChosen(event.target.value)}><option value="">Choose a session to read its evidence</option>{sessions.map(item => <option key={JSON.stringify([item.sourceId, item.sessionId])} value={JSON.stringify([item.sourceId, item.sessionId])}>{item.sourceId} · {item.sessionId} · {item.model}{item.archived ? " · archived" : ""}</option>)}</select></label>
    <p className="text-xs text-fg-muted mt-1">{sessions.length} of {matched} matching sessions offered. Narrow the date, source, or model filters to locate others. Evidence is read only for the chosen session.</p>
    {selection.outcome && <p className="text-xs text-fg-muted mt-2">Outcome provenance filters the Timeline scores above. This lab retains the other filters and includes sessions without an outcome score.</p>}
    {loading && <p role="status" className="text-xs mt-3">Reading bounded evidence…</p>}{error && <p role="alert" className="text-xs text-warn mt-3">{error}</p>}
    {packet && <div className="analysis-reveal mt-4">
      <p className="text-xs text-fg-muted">Deterministic evidence · {packet.records.length} retained records · sufficiency: {packet.evaluation.sufficiency}. These dimensions describe receipts; they do not replace a goal-quality verdict.</p>
      {packet.bounds.warnings.length > 0 && <p className="text-xs text-warn mt-2">{packet.bounds.warnings.join(" ")}</p>}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 mt-3">{(["completionEvidence", "verification", "recovery", "unresolvedIssues"] as const).map(key => { const item = packet.evaluation[key]; return <div className="rounded-lg border border-bd p-3" key={key}><div className="text-xs font-medium capitalize">{key.replace(/([A-Z])/g, " $1")}</div><div className="text-sm mt-1">{item.status}</div><p className="text-xs text-fg-muted mt-1">{item.summary}</p><p className="text-[10px] text-fg-dim mt-2">{item.evidenceIds.length} supporting references</p></div>; })}</div>
      <div className="mt-4"><EvidenceEventLanes key={packet.contentDigest} records={packet.records} onSelect={setSequenceIds} /></div>
      <div className="flex flex-wrap gap-2 mt-4"><label className="text-xs">Task episode<select aria-label="Evidence episode" className="analysis-input block mt-1" value={episode} onChange={event => setEpisode(event.target.value)}><option value="">All episodes</option>{packet.episodes.map((item, index) => <option key={item.episodeId} value={item.episodeId}>Episode {index + 1} · {item.boundary} boundary</option>)}</select></label><label className="text-xs">Evidence channel<select aria-label="Evidence channel" className="analysis-input block mt-1" value={recordKind} onChange={event => setRecordKind(event.target.value)}>{["all", "request", "tool_call", "tool_result", "error", "final_output", "claims"].map(kind => <option key={kind} value={kind}>{kind.replaceAll("_", " ")}</option>)}</select></label></div>
      {selectedEpisode && <p className="text-xs text-fg-muted mt-2">{selectedEpisode.boundaryReason}</p>}
      <details className="mt-3"><summary className="cursor-pointer text-xs font-medium">Read {records.length} evidence excerpts</summary><ol className="space-y-2 mt-3 max-h-[32rem] overflow-auto">{records.map(record => <li key={record.evidenceId} id={`evidence-${record.evidenceId}`} className="rounded-lg border border-bd-subtle p-3"><p className="text-xs font-medium">{record.kind.replaceAll("_", " ")} · {record.claimed ? "assistant claim" : record.status} · <span className="mono text-[10px]">{record.evidenceId}</span></p><p className="text-xs text-fg-muted whitespace-pre-wrap break-words mt-1">{show(record.excerpt)}</p></li>)}</ol></details>
      <div className="mt-4 border-t border-bd-subtle pt-4"><h3 className="text-xs font-medium">Model review history</h3><p className="text-xs text-fg-muted mt-1">Latest 20 retained reviews for this session. Packet and prompt matches describe freshness; compare the selected review methods separately.</p>
        {!receipts.length && <p className="text-xs text-fg-muted mt-2">No evidence-linked reviews have been recorded. Legacy scores are not evidence-linked receipts.</p>}
        {receipts.map(receipt => <details className="mt-2 rounded-lg border border-bd-subtle p-3" key={receipt.receiptId}><summary className="cursor-pointer text-xs">{receipt.outcome.replaceAll("_", " ")} · {receipt.score === null ? "unscored" : `${Math.round(receipt.score * 100)}%`} · {receipt.confidence} confidence · {receipt.evidenceMatches && receipt.promptMatches ? "packet and prompt match" : "historical / stale"}</summary><p className="text-xs text-fg-muted mt-2">{receipt.selection?.source ?? "Unknown backend"} · {receipt.selection?.model ?? "Unknown model"} · {receipt.selection?.reasoningEffort ?? "Unspecified effort"} · {new Date(receipt.createdAt).toLocaleString()} · prompt v{receipt.promptVersion}</p><ul className="text-xs mt-2 space-y-1">{receipt.reasons.map((reason, index) => <li key={index}>{show(reason)}</li>)}</ul>{receipt.dimensions && <dl className="grid sm:grid-cols-2 gap-2 text-xs mt-2">{Object.entries(receipt.dimensions).map(([label, value]) => <div key={label}><dt className="text-fg-muted">{label}</dt><dd>{typeof value === "string" ? value : typeof value === "object" && value !== null && "status" in value ? String(value.status) : "unknown"}</dd></div>)}</dl>}<p className="text-[10px] text-fg-muted mt-2">Evidence: {receipt.evidenceIds.join(", ") || "None"}. Contradictions: {receipt.contradictionEvidenceIds.join(", ") || "None"}.</p></details>)}
      </div>
      <details className="mt-3"><summary className="cursor-pointer text-xs text-fg-muted">Packet provenance</summary><p className="text-[10px] mono break-all mt-2">{packet.version} · {packet.format} · {packet.contentDigest}</p></details>
    </div>}
  </section>;
}
