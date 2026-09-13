"use client";
import Link from "next/link";
import { requestJson } from "@/lib/client-request";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useRedactedShow } from "@/lib/use-redaction";

interface SearchResponse { matches: Match[]; scannedTurns: number; complete: boolean; truncated: boolean; nextCursor: string | null }
interface Match { index: number; label: string; excerpt: string; windowCursor: string }
export function HighlightText({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) : -1;
  return at < 0 ? <>{text}</> : <>{text.slice(0, at)}<mark>{text.slice(at, at + query.length)}</mark>{text.slice(at + query.length)}</>;
}

export function TranscriptSearch({ sourceId, sessionId }: { sourceId: string; sessionId: string }) {
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("search") ?? "";
  const activeRequest = useRef<AbortController | null>(null);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 250);
  const q = debouncedQuery.trim();
  const [matches, setMatches] = useState<Match[]>([]);
  const [scanned, setScanned] = useState(0), [complete, setComplete] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState(0);
  const [continuation, setContinuation] = useState<string | null>(null), [resume, setResume] = useState(0);
  const [limited, setLimited] = useState(false);
  const harvest = useMemo(() => matches.flatMap(m => [m.label, m.excerpt]), [matches]);
  const { show } = useRedactedShow(harvest, { secrets: true });
  useEffect(() => { setQuery(urlQuery); }, [urlQuery, sourceId, sessionId]);
  useEffect(() => {
    const controller = new AbortController(); activeRequest.current = controller;
    setMatches([]); setScanned(0); setComplete(false); setError(""); setPosition(0); setContinuation(null); setLimited(false);
    if (!q) { setBusy(false); return () => controller.abort(); }
    setBusy(true);
    void (async () => {
      let cursor: string | null = null;
      let found: Match[] = [];
      // Yield between bounded requests. Stop after 40 pages or 240 matches;
      // continuation is explicit, and no full-file read runs in the browser.
      for (let page = 0; page < 40; page++) {
        const params = new URLSearchParams({ sourceId, sessionId, q });
        if (cursor) params.set("cursor", cursor);
        const body = await requestJson<SearchResponse>(`/api/collection/transcript?${params}`, { signal: controller.signal, message: "Session search could not finish." });
        if (controller.signal.aborted) return;
        found = [...found, ...body.matches]; setMatches(found); setScanned(body.scannedTurns); setComplete(body.complete); setLimited(body.truncated);
        cursor = body.nextCursor; setContinuation(cursor);
        if (!cursor || found.length >= 240) break;
      }
    })().catch(reason => { if (!controller.signal.aborted) setError(reason.message); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [q, debouncedQuery, sourceId, sessionId, resume]);
  // Continue with a bounded next batch without retaining an unbounded result list.
  async function continueSearch() {
    if (!continuation || busy) return;
    const controller = activeRequest.current;
    if (!controller || controller.signal.aborted) return;
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams({ sourceId, sessionId, q, cursor: continuation });
      const body = await requestJson<SearchResponse>(`/api/collection/transcript?${params}`, { signal: controller.signal, message: "Session search could not finish." });
      if (controller.signal.aborted) return;
      setMatches(body.matches); setPosition(0); setScanned(body.scannedTurns); setComplete(body.complete); setContinuation(body.nextCursor); setLimited(body.truncated);
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Search failed."); } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <section className="card p-3 mb-4 space-y-3" aria-label="Whole-session search">
    <label className="block text-sm font-medium">Search the entire session<input type="search" maxLength={256} value={query} onChange={e => { activeRequest.current?.abort(); setMatches([]); setBusy(false); setContinuation(null); setComplete(false); setScanned(0); setError(""); setQuery(e.target.value); }} className="analysis-input block w-full mt-2" placeholder="Find a message, tool call or result…" /></label>
    {q && <>
      <p className="text-xs text-fg-muted" role="status">{busy ? "Searching… " : ""}{matches.length} matches in this result batch · {scanned} turns scanned · {complete ? limited ? "Reached available transcript limit" : "Search complete" : busy ? "Search in progress" : "Search paused"}. Search matches redacted text; hidden paths and secrets are not searchable.</p>
      {error && <p role="alert" className="text-sm text-err">{error} <button className="analysis-control" onClick={() => setResume(v => v + 1)}>Restart search</button></p>}
      {!!matches.length && <div className="flex flex-wrap items-center gap-2"><button className="analysis-control" disabled={position === 0} onClick={() => setPosition(v => v - 1)}>Previous match</button><span className="text-xs">{position + 1} / {matches.length}</span><button className="analysis-control" disabled={position >= matches.length - 1} onClick={() => setPosition(v => v + 1)}>Next match</button></div>}
      {matches[position] && (() => {
        const match = matches[position];
        const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
        params.set("sourceId", sourceId); params.set("sessionId", sessionId); params.set("window", match.windowCursor); params.set("turn", String(match.index)); params.set("search", q);
        return <Link className="evidence-result block rounded-md border border-bd p-3 text-sm hover:bg-bg-elev" href={`/collection/session?${params}#turn-${match.index}`}><span className="block font-medium">{show(match.label)} · message {match.index + 1} · Open context</span><span className="block whitespace-pre-wrap break-words mt-1 text-fg-muted"><HighlightText text={show(match.excerpt)} query={q} /></span></Link>;
      })()}
      {continuation && !busy && !error && <button className="analysis-control" onClick={() => void continueSearch()}>Continue searching later messages</button>}
    </>}
  </section>;
}
