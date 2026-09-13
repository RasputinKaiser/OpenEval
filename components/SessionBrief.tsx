"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { EvidencePacket } from "@/lib/insights/evidence";
import { buildSessionBrief, type SessionBrief as SessionBriefModel, type SessionBriefStatus } from "@/lib/collection/session-brief";
import { parseEvidenceNavigation, setEvidenceNavigation } from "@/lib/collection/evidence-navigation";
import { buildUnknownActions, formatUnavailableReason, type UnknownAction } from "@/lib/insights/unknown-actions";
import { useRedactedShow } from "@/lib/use-redaction";
import { RedactToggle } from "./RedactToggle";

interface SessionBriefProps {
  /** Pass null from an existing evidence viewer to keep this component fetch-free. */
  packet?: EvidencePacket | null;
  sourceId?: string;
  sessionId?: string;
  embedded?: boolean;
  excerptDisplay?: (excerpt: string) => string;
}

function statusLabel(status: SessionBriefStatus): string {
  return status === "unknown" ? "unknown" : status;
}

function statusClass(status: SessionBriefStatus): string {
  if (status === "pass") return "text-ok";
  if (status === "fail") return "text-err";
  if (status === "mixed") return "text-warn";
  return "text-fg-muted";
}

function Citation({ evidenceId, model, show, selectedEvidenceId, onSelect }: { evidenceId: string; model: SessionBriefModel; show: (value: string) => string; selectedEvidenceId?: string; onSelect?: (evidenceId: string) => void }) {
  const citation = model.citations.find((item) => item.evidenceId === evidenceId);
  if (!citation) return <span className="mono text-[10px] text-fg-dim">{evidenceId} · excerpt unavailable</span>;
  return (
    <details open={selectedEvidenceId === evidenceId} className="mt-1 rounded border border-bd-subtle bg-bg px-2 py-1">
      <summary className="cursor-pointer text-[10px] text-accent-soft" onClick={() => onSelect?.(evidenceId)}>
        Evidence <span className="mono">{evidenceId}</span> · reveal excerpt
      </summary>
      <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-4 text-fg-muted">{show(citation.excerpt)}</p>
    </details>
  );
}

function CitationList({ evidenceIds, model, show, selectedEvidenceId, onSelect }: { evidenceIds: string[]; model: SessionBriefModel; show: (value: string) => string; selectedEvidenceId?: string; onSelect?: (evidenceId: string) => void }) {
  if (evidenceIds.length === 0) return <span className="text-[10px] text-fg-dim">No retained evidence ID.</span>;
  const visible = evidenceIds.slice(0, 3);
  const remaining = evidenceIds.slice(3);
  return <div className="mt-1">{visible.map((evidenceId) => <Citation key={evidenceId} evidenceId={evidenceId} model={model} show={show} selectedEvidenceId={selectedEvidenceId} onSelect={onSelect} />)}{remaining.length > 0 && <details className="mt-1"><summary className="cursor-pointer text-[10px] text-accent-soft">Show {remaining.length} more evidence citations</summary><div className="mt-1">{remaining.map((evidenceId) => <Citation key={evidenceId} evidenceId={evidenceId} model={model} show={show} selectedEvidenceId={selectedEvidenceId} onSelect={onSelect} />)}</div></details>}</div>;
}

function causeLabel(cause: UnknownAction["cause"]): string {
  return cause.replaceAll("_", " ");
}

export function UnknownActionsPanel({ actions, model, show, compact = false, selectedEvidenceId, onSelect }: { actions: UnknownAction[]; model?: SessionBriefModel; show?: (value: string) => string; compact?: boolean; selectedEvidenceId?: string; onSelect?: (evidenceId: string) => void }) {
  if (actions.length === 0) return null;
  const content = <>
    <div><h3 id="session-unknown-actions-title" className="text-xs font-medium">Unknowns and next actions</h3><p className="mt-1 text-[11px] text-fg-muted">Why evidence is incomplete and what you can inspect next.</p></div>
    <ul className="mt-2 space-y-2">{actions.map((item) => <li key={item.id} className="rounded border border-bd-subtle p-2.5"><div className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-xs font-medium">{item.title}</span><span className="text-[10px] capitalize text-fg-dim">{causeLabel(item.cause)}</span></div><p className="mt-1 text-[11px] text-fg-muted">{item.explanation}</p><p className="mt-1 text-[11px]"><span className="font-medium text-fg">Next:</span> {item.nextAction}</p>{item.limitSummary && <p className="mt-1 text-[10px] text-fg-dim">Bound: {item.limitSummary}</p>}{item.evidenceCount > 0 && <>{model && show ? <CitationList evidenceIds={item.evidenceIds} model={model} show={show} selectedEvidenceId={selectedEvidenceId} onSelect={onSelect} /> : <p className="mt-1 mono text-[10px] text-fg-dim">Evidence IDs: {item.evidenceIds.join(", ")}</p>}{item.evidenceCount > item.evidenceIds.length && <p className="mt-1 text-[10px] text-fg-dim">Showing {item.evidenceIds.length} of {item.evidenceCount} supporting references.</p>}</>}{item.transcriptHref && <Link className="mt-2 inline-flex text-[10px] text-accent-soft underline-offset-2 hover:underline" href={item.transcriptHref}>Open existing transcript</Link>}</li>)}</ul>
  </>;
  return <section className="mt-3 rounded-lg border border-bd bg-bg p-3" aria-labelledby="session-unknown-actions-title">{compact ? <details><summary className="cursor-pointer text-xs font-medium text-accent-soft">Unknowns and next actions ({actions.length})</summary><div className="mt-2">{content}</div></details> : content}</section>;
}

function Quote({ label, quote, model, show, selectedEvidenceId, onSelect }: { label: string; quote: SessionBriefModel["request"]; model: SessionBriefModel; show: (value: string) => string; selectedEvidenceId?: string; onSelect?: (evidenceId: string) => void }) {
  const displayLabel = quote?.label ?? label;
  return (
    <div className="rounded-lg border border-bd-subtle bg-bg p-3">
      <div className="text-[10px] font-medium uppercase tracking-wide text-fg-dim">{displayLabel}</div>
      {quote ? <><p className="mt-1 whitespace-pre-wrap break-words text-xs text-fg-muted">{show(quote.excerpt)}</p>{quote.finality === "unknown" && <p className="mt-1 text-[10px] text-fg-dim">Finality unknown: this retained assistant output is not proof of a final deliverable.</p>}<CitationList evidenceIds={[quote.evidenceId]} model={model} show={show} selectedEvidenceId={selectedEvidenceId} onSelect={onSelect} /></> : <p className="mt-1 text-xs text-fg-muted">Unknown — no retained {label.toLowerCase()} excerpt.</p>}
    </div>
  );
}

function BriefBody({ model, show, selectedEvidenceId, onSelect }: { model: SessionBriefModel; show: (value: string) => string; selectedEvidenceId?: string; onSelect?: (evidenceId: string) => void }) {
  const observedCheckCount = model.checks.filter((check) => check.evidenceIds.length > 0).length;
  return <>
    <div className="grid gap-2 sm:grid-cols-2">
      <Quote label="Request" quote={model.request} model={model} show={show} selectedEvidenceId={selectedEvidenceId} onSelect={onSelect} />
      <Quote label="Final output" quote={model.final} model={model} show={show} selectedEvidenceId={selectedEvidenceId} onSelect={onSelect} />
    </div>

    <div className="mt-3">
      <h3 className="text-xs font-medium">Attempts <span className="text-fg-dim">({model.attempts.length}{model.bounds.attemptsOmitted > 0 ? ` of ${model.attempts.length + model.bounds.attemptsOmitted}` : ""})</span></h3>
      {model.attempts.length === 0 ? <p className="mt-1 text-xs text-fg-muted">Unknown — no retained tool attempt.</p> : <details className="mt-2 rounded-lg border border-bd-subtle p-2.5"><summary className="cursor-pointer text-xs text-accent-soft">Reveal bounded attempts and citations</summary><ol className="mt-2 space-y-2">{model.attempts.map((attempt) => <li key={attempt.attempt} className="rounded-lg border border-bd-subtle p-2.5"><div className="flex flex-wrap items-baseline justify-between gap-2 text-xs"><span>{attempt.tool} attempt {attempt.attempt}</span><span className={statusClass(attempt.status)}>{statusLabel(attempt.status)}</span></div><p className="mt-1 text-[10px] leading-4 text-fg-dim mono break-words">{attempt.excerpt ? show(attempt.excerpt) : "No call arguments retained."}</p><p className="mt-1 text-[11px] text-fg-muted">{attempt.summary}</p><CitationList evidenceIds={attempt.evidenceIds} model={model} show={show} selectedEvidenceId={selectedEvidenceId} onSelect={onSelect} /></li>)}</ol></details>}
    </div>

    <div className="mt-3">
      <h3 className="text-xs font-medium">Observed checks <span className="text-fg-dim">({observedCheckCount})</span></h3>
      <details className="mt-2 rounded-lg border border-bd-subtle p-2.5"><summary className="cursor-pointer text-xs text-accent-soft">Reveal observed checks and citations{observedCheckCount === 0 ? " (unknown)" : ""}</summary><ul className="mt-2 space-y-2">{model.checks.map((check, index) => <li key={`${check.evidenceIds.join(",")}:${index}`} className="rounded-lg border border-bd-subtle p-2.5"><div className="flex flex-wrap items-baseline justify-between gap-2 text-xs"><span className={statusClass(check.status)}>{statusLabel(check.status)}</span><span className="text-fg-muted">{check.summary}</span></div><CitationList evidenceIds={check.evidenceIds} model={model} show={show} selectedEvidenceId={selectedEvidenceId} onSelect={onSelect} /></li>)}</ul></details>
    </div>

    <div className="mt-3">
      <h3 className="text-xs font-medium">Unresolved</h3>
      <ul className="mt-2 space-y-2">{model.unresolved.map((item, index) => <li key={`${item.evidenceIds.join(",")}:${index}`} className="rounded-lg border border-bd-subtle p-2.5"><div className="flex flex-wrap items-baseline justify-between gap-2 text-xs"><span className={statusClass(item.status)}>{statusLabel(item.status)}</span><span className="text-fg-muted">{item.summary}</span></div><CitationList evidenceIds={item.evidenceIds} model={model} show={show} selectedEvidenceId={selectedEvidenceId} onSelect={onSelect} /></li>)}</ul>
    </div>

    <div className="mt-3 border-t border-bd-subtle pt-2 text-[10px] text-fg-dim">
      Transport completion: <span className={statusClass(model.completion.status)}>{statusLabel(model.completion.status)}</span>. This is turn evidence only; it does not establish goal success.
      <CitationList evidenceIds={model.completion.evidenceIds} model={model} show={show} selectedEvidenceId={selectedEvidenceId} onSelect={onSelect} />
      <span className="mt-1 block">Bounded packet: {model.bounds.recordsRetained} retained records{model.bounds.truncated ? " · truncated" : ""}{model.bounds.unsupportedFormat ? " · unsupported source" : model.bounds.unsupportedRecords ? " · unsupported records" : ""}.</span>
    </div>
  </>;
}

export function SessionBrief({ packet, sourceId, sessionId, embedded = false, excerptDisplay }: SessionBriefProps) {
  const externallyProvided = packet !== undefined;
  const [fetchedPacket, setFetchedPacket] = useState<EvidencePacket | null>(null);
  const [loading, setLoading] = useState(!externallyProvided && Boolean(sourceId && sessionId));
  const [error, setError] = useState("");
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | undefined>();
  useEffect(() => {
    const sync = () => setSelectedEvidenceId(parseEvidenceNavigation(new URLSearchParams(window.location.search)).evidenceId);
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const selectEvidence = (evidenceId: string) => {
    const url = new URL(window.location.href);
    const current = parseEvidenceNavigation(url.searchParams);
    const params = setEvidenceNavigation(url.searchParams, { ...current, sourceId: sourceId ?? current.sourceId, sessionId: sessionId ?? current.sessionId, evidenceId });
    const next = `${url.pathname}?${params.toString()}${url.hash}`;
    if (`${url.pathname}${url.search}${url.hash}` !== next) window.history.pushState(null, "", next);
    window.dispatchEvent(new PopStateEvent("popstate"));
    setSelectedEvidenceId(evidenceId);
  };
  useEffect(() => {
    if (externallyProvided || !sourceId || !sessionId) return;
    const controller = new AbortController();
    setFetchedPacket(null);
    setLoading(true);
    setError("");
    fetch(`/api/collection/evidence?${new URLSearchParams({ sourceId, sessionId })}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { packet?: EvidencePacket; error?: string };
        if (!response.ok || !body.packet) throw new Error(body.error || "Evidence is unavailable.");
        return body.packet;
      })
      .then(setFetchedPacket)
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Evidence is unavailable.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [externallyProvided, sessionId, sourceId]);

  const activePacket = externallyProvided ? packet : fetchedPacket;
  const excerpts = useMemo(() => activePacket?.records.map((record) => record.excerpt) ?? [], [activePacket]);
  const { redact, setRedact, show: redactedShow } = useRedactedShow(excerpts, { secrets: true });
  const show = excerptDisplay ?? redactedShow;
  const model = useMemo(() => activePacket ? buildSessionBrief(activePacket) : null, [activePacket]);
  const unknownActions = useMemo(() => buildUnknownActions(activePacket, { sourceId, sessionId, unavailableReason: error || undefined }), [activePacket, error, sessionId, sourceId]);

  if (!model) {
    if (embedded) return null;
    return <section className="card mb-5 p-4" aria-labelledby="session-brief-title" aria-busy={loading}><div className="flex items-start justify-between gap-3"><div><h2 id="session-brief-title" className="text-sm font-medium">Session brief</h2><p className="mt-1 text-xs text-fg-muted">A bounded evidence brief loads when this session detail is opened.</p></div><RedactToggle redact={redact} onToggle={() => setRedact(!redact)} /></div>{loading && <p role="status" className="mt-3 text-xs text-fg-muted">Reading bounded evidence…</p>}{error && <p role="alert" className="mt-3 text-xs text-warn">{formatUnavailableReason(error)}</p>}{selectedEvidenceId && <p role="status" className="mt-2 text-xs text-fg-muted">Historical evidence reference <span className="mono">{selectedEvidenceId}</span> is unavailable in the current bounded packet.</p>}<UnknownActionsPanel actions={unknownActions} /></section>;
  }

  const selectedCitation = selectedEvidenceId ? model.citations.find((item) => item.evidenceId === selectedEvidenceId) : undefined;

  return <section className={embedded ? "mt-4 rounded-lg border border-bd-subtle bg-bg p-3" : "card mb-5 p-4"} aria-labelledby="session-brief-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="session-brief-title" className="text-sm font-medium">Session brief</h2><p className="mt-1 text-xs text-fg-muted">Deterministic excerpts and receipts from this bounded packet. Unknown means the retained evidence does not establish the claim.</p></div>{!embedded && <RedactToggle redact={redact} onToggle={() => setRedact(!redact)} />}</div>
    {selectedEvidenceId && !selectedCitation && <p role="status" className="mt-2 text-xs text-fg-muted">Historical evidence reference <span className="mono">{selectedEvidenceId}</span> is unavailable in the current bounded packet. The packet may have been truncated or refreshed.</p>}
    <UnknownActionsPanel actions={unknownActions} model={model} show={show} compact={embedded} selectedEvidenceId={selectedEvidenceId} onSelect={selectEvidence} />
    <div className="mt-3"><BriefBody model={model} show={show} selectedEvidenceId={selectedEvidenceId} onSelect={selectEvidence} /></div>
  </section>;
}
