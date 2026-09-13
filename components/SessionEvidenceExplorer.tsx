"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EvidencePacket } from "@/lib/insights/evidence";
import { selectionParams, type ChartSelection } from "@/lib/chart-analysis";
import type { EvidenceSessionListItem, EvidenceSessionListPage } from "@/lib/collection/evidence-session-list";
import { parseEvidenceNavigation, setEvidenceNavigation } from "@/lib/collection/evidence-navigation";
import { useRedactedShow } from "@/lib/use-redaction";
import { EvidenceEventLanes } from "./EvidenceEventLanes";
import { RedactToggle } from "./RedactToggle";
import { SessionBrief, UnknownActionsPanel } from "./SessionBrief";
import { buildUnknownActions, formatUnavailableReason } from "@/lib/insights/unknown-actions";

interface EvidenceReceipt {
  receiptId: string; outcome: string; score: number | null; confidence: string; reasons: string[];
  evidenceIds: string[]; contradictionEvidenceIds: string[]; dimensions?: Record<string, unknown>;
  selection?: { source: string; model: string; reasoningEffort?: string | null }; createdAt: number;
  promptVersion: number; evidenceVersion: string; evidenceMatches: boolean; promptMatches: boolean;
}
export function SessionEvidenceExplorer({ selection }: { selection: ChartSelection }) {
  const [sessions, setSessions] = useState<EvidenceSessionListItem[]>([]), [matched, setMatched] = useState(0), [chosen, setChosen] = useState("");
  const [metadataQuery, setMetadataQuery] = useState(""), [generation, setGeneration] = useState<number>(), [nextOffset, setNextOffset] = useState<number | null>(null), [listLoading, setListLoading] = useState(false), [listRestart, setListRestart] = useState(0), [stalePagination, setStalePagination] = useState(false);
  const [packet, setPacket] = useState<EvidencePacket | null>(null), [loading, setLoading] = useState(false), [listError, setListError] = useState(""), [packetError, setPacketError] = useState("");
  const listVersion = useRef(0);
  const [receipts, setReceipts] = useState<EvidenceReceipt[]>([]);
  const [sequenceIds, setSequenceIds] = useState<string[] | null>(null);
  const [episode, setEpisode] = useState(""), [recordKind, setRecordKind] = useState("all");
  const query = selectionParams({ ...selection, outcome: undefined }).toString();
  useEffect(() => {
    const sync = () => {
      const navigation = parseEvidenceNavigation(new URLSearchParams(window.location.search));
      setChosen(navigation.sourceId && navigation.sessionId ? JSON.stringify([navigation.sourceId, navigation.sessionId]) : "");
      setMetadataQuery(new URLSearchParams(window.location.search).get("evidenceQ") ?? "");
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  useEffect(() => {
    const version = ++listVersion.current;
    const controller = new AbortController(); setSessions([]); setMatched(0); setGeneration(undefined); setNextOffset(null); setListLoading(true); setListError(""); setStalePagination(false);
    const params = new URLSearchParams(query); if (metadataQuery.trim()) params.set("q", metadataQuery.trim()); params.set("limit", "40");
    fetch(`/api/collection/evidence/sessions?${params}`, { signal: controller.signal }).then(async response => { const body = await response.json() as Partial<EvidenceSessionListPage> & { error?: string }; if (!response.ok) throw new Error(body.error || "Session selection is unavailable."); return body as EvidenceSessionListPage; }).then(page => { if (version !== listVersion.current) return; setSessions(page.sessions); setMatched(page.totalMatched); setGeneration(page.generation); setNextOffset(page.nextOffset); }).catch(reason => { if (reason.name !== "AbortError" && version === listVersion.current) setListError(reason.message); }).finally(() => { if (!controller.signal.aborted && version === listVersion.current) setListLoading(false); });
    return () => controller.abort();
  }, [listRestart, metadataQuery, query]);
  const loadMore = useCallback(() => {
    if (nextOffset === null || listLoading) return;
    const version = listVersion.current;
    const controller = new AbortController(); setListLoading(true); setListError("");
    const params = new URLSearchParams(query); if (metadataQuery.trim()) params.set("q", metadataQuery.trim()); params.set("limit", "40"); params.set("offset", String(nextOffset)); if (generation !== undefined) params.set("generation", String(generation));
    fetch(`/api/collection/evidence/sessions?${params}`, { signal: controller.signal }).then(async response => { const body = await response.json() as Partial<EvidenceSessionListPage> & { error?: string }; if (!response.ok) { if (response.status === 409) throw new Error("The evidence snapshot changed; restart pagination."); throw new Error(body.error || "More sessions are unavailable; restart the search."); } return body as EvidenceSessionListPage; }).then(page => { if (version !== listVersion.current) return; setSessions(previous => [...previous, ...page.sessions]); setMatched(page.totalMatched); setGeneration(page.generation); setNextOffset(page.nextOffset); }).catch(reason => { if (reason.name !== "AbortError" && version === listVersion.current) { setListError(reason.message); setStalePagination(reason.message.includes("snapshot changed")); } }).finally(() => { if (!controller.signal.aborted && version === listVersion.current) setListLoading(false); });
  }, [generation, listLoading, metadataQuery, nextOffset, query]);
  useEffect(() => {
    if (!chosen) { setPacket(null); setPacketError(""); return; }
    const controller = new AbortController(); const [sourceId, sessionId] = JSON.parse(chosen) as [string, string];
    setLoading(true); setReceipts([]); setPacket(null); setPacketError(""); setEpisode(""); setRecordKind("all"); setSequenceIds(null);
    fetch(`/api/collection/evidence?${new URLSearchParams({ sourceId, sessionId })}`, { signal: controller.signal }).then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Evidence is unavailable."); return body as { packet: EvidencePacket; receipts: EvidenceReceipt[] }; }).then(body => { setPacket(body.packet); setReceipts(body.receipts ?? []); }).catch(reason => { if (reason.name !== "AbortError") setPacketError(reason.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [chosen]);
  const excerpts = useMemo(() => [...(packet?.records.map(record => record.excerpt) ?? []), ...receipts.flatMap(receipt => receipt.reasons)], [packet, receipts]);
  const redactValues = useMemo(() => [...excerpts, ...sessions.map(session => session.title)], [excerpts, sessions]);
  const { redact, setRedact, show } = useRedactedShow(redactValues, { secrets: true });
  const unavailableActions = useMemo(() => {
    if (!packetError || packet) return [];
    let identity: { sourceId?: string; sessionId?: string } = {};
    try { if (chosen) { const parsed = JSON.parse(chosen) as [string, string]; identity = { sourceId: parsed[0], sessionId: parsed[1] }; } } catch { /* selection is controlled by the option list */ }
    return buildUnknownActions(null, { ...identity, unavailableReason: packetError });
  }, [chosen, packetError, packet]);
  const selectedEpisode = packet?.episodes.find(item => item.episodeId === episode);
  const records = packet?.records.filter(record => (!sequenceIds || sequenceIds.includes(record.evidenceId)) && (!selectedEpisode || selectedEpisode.evidenceIds.includes(record.evidenceId)) && (recordKind === "all" || (recordKind === "claims" ? record.claimed : record.kind === recordKind))) ?? [];
  const chooseSession = (value: string) => {
    let navigation = {};
    try {
      const parsed = value ? JSON.parse(value) as [string, string] : [];
      navigation = parsed.length === 2 ? { sourceId: parsed[0], sessionId: parsed[1] } : {};
    } catch { navigation = {}; }
    const url = new URL(window.location.href);
    const params = setEvidenceNavigation(url.searchParams, navigation);
    const next = `${url.pathname}?${params.toString()}${url.hash}`;
    if (`${url.pathname}${url.search}${url.hash}` !== next) window.history.pushState(null, "", next);
    window.dispatchEvent(new PopStateEvent("popstate"));
    setChosen(value);
  };
  const updateMetadataQuery = (value: string) => {
    setMetadataQuery(value);
    const url = new URL(window.location.href);
    if (value.trim()) url.searchParams.set("evidenceQ", value); else url.searchParams.delete("evidenceQ");
    window.history.replaceState(null, "", url);
  };
  const selectedRow = sessions.find(item => JSON.stringify([item.sourceId, item.sessionId]) === chosen);
  const selectedOutsidePage = Boolean(chosen && !selectedRow);
  return <section className="card p-4 sm:p-5 mb-5" aria-labelledby="session-evidence-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-medium" id="session-evidence-title">Session evidence lab</h2><p className="text-xs text-fg-muted mt-1">Inspect observed receipts, task boundaries, and unknowns before reviewing an outcome.</p></div><RedactToggle redact={redact} onToggle={() => setRedact(!redact)} /></div>
    <label className="text-xs block mt-3">Search evidence sessions <input aria-label="Search evidence session metadata" type="search" className="analysis-input block w-full mt-1" value={metadataQuery} onChange={event => updateMetadataQuery(event.target.value)} placeholder="Title, session ID, or model" /></label>
    <p className="text-[10px] text-fg-dim mt-1">Metadata search · title, session ID, model; not full-text.</p>
    <label className="text-xs block mt-3">Session in the current selection<select aria-label="Session evidence selection" className="analysis-input block w-full mt-1" value={chosen} onChange={event => chooseSession(event.target.value)}><option value="">Choose a session to read its evidence</option>{selectedRow === undefined && chosen && <option value={chosen}>Selected session · {chosen.replace(/[\[\]"]+/g, " ").replace(",", " · ")}</option>}{sessions.map(item => { const value = JSON.stringify([item.sourceId, item.sessionId]); return <option key={value} value={value}>{show(item.title)} · {item.sourceId} · {item.sessionId} · {show(item.model)}{item.archived ? " · archived" : ""}</option>; })}</select></label>
    <p className="text-xs text-fg-muted mt-1">{sessions.length} of {matched} matching sessions offered. Results are bounded metadata; evidence is read only for the chosen session.</p>
    {selectedOutsidePage && <p className="text-xs text-fg-muted mt-1">The selected session is retained from the URL but is outside this page or metadata search result.</p>}
    {listError && <p role="alert" className="text-xs text-warn mt-2">{formatUnavailableReason(listError)}</p>}
    {stalePagination && <button type="button" className="analysis-control mt-2" onClick={() => setListRestart(value => value + 1)}>Restart evidence pagination</button>}
    {nextOffset !== null && !stalePagination && <button type="button" className="analysis-control mt-2" onClick={loadMore} disabled={listLoading}>{listLoading ? "Loading sessions…" : `Load more (${Math.max(0, matched - sessions.length)} remaining)`}</button>}
    {selection.outcome && <p className="text-xs text-fg-muted mt-2">Outcome provenance filters the Timeline scores above. This lab retains the other filters and includes sessions without an outcome score.</p>}
    {loading && <p role="status" className="text-xs mt-3">Reading bounded evidence…</p>}{packetError && <p role="alert" className="text-xs text-warn mt-3">{formatUnavailableReason(packetError)}</p>}{unavailableActions.length > 0 && <UnknownActionsPanel actions={unavailableActions} compact />}
    {packet && <div className="analysis-reveal mt-4">
      <p className="text-xs text-fg-muted">Deterministic evidence · {packet.records.length} retained records · sufficiency: {packet.evaluation.sufficiency}. These dimensions describe receipts; they do not replace a goal-quality verdict.</p>
      {packet.bounds.warnings.length > 0 && <p className="text-xs text-warn mt-2">{packet.bounds.warnings.join(" ")}</p>}
      <SessionBrief packet={packet} embedded excerptDisplay={show} />
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
