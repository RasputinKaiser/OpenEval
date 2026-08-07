import path from "node:path";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, FileText, AlertTriangle, Archive, MessageSquare, Wrench } from "lucide-react";
import { readTranscriptWindow } from "@/lib/live";
import { resolveCollectionSession, resolveLegacyCollectionFile } from "@/lib/collection/resolver";
import { encodeTranscriptCursor, transcriptDescriptorHash } from "@/lib/collection/transcript-cursor";
import { PARSER_VERSION } from "@/lib/live-cache";
import { fmtNum, fmtRel } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import TranscriptClient from "@/components/TranscriptClient";

export const dynamic = "force-dynamic";

const RENDER_CAP = 240;

export default async function SessionViewerPage({ searchParams }: { searchParams?: Promise<{ sourceId?: string; sessionId?: string; pathHint?: string; file?: string }> }) {
  const params = await searchParams;
  const legacyFile = params?.file ?? params?.pathHint;
  if ((!params?.sourceId || !params?.sessionId) && legacyFile) {
    const resolvedLegacy = resolveLegacyCollectionFile(legacyFile);
    if (resolvedLegacy && "file" in resolvedLegacy) {
      redirect(`/collection/session?sourceId=${encodeURIComponent(resolvedLegacy.sourceId)}&sessionId=${encodeURIComponent(resolvedLegacy.sessionId)}`);
    }
  }

  const back = (
    <Link href="/collection" className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg mb-2">
      <ArrowLeft className="size-3.5" /> Collection
    </Link>
  );
  const sourceId = params?.sourceId ?? "";
  const sessionId = params?.sessionId ?? "";
  const resolved = sourceId && sessionId ? resolveCollectionSession({ sourceId, sessionId }) : null;

  if (!resolved) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        {back}
        <div className="card p-4 text-sm text-err flex items-center gap-2">
          <AlertTriangle className="size-4 shrink-0" />
          {legacyFile ? "That transcript reference is not present in the current source inventory." : "A source-qualified session reference is required."}
        </div>
      </div>
    );
  }

  if (!("file" in resolved)) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        {back}
        <PageHeader icon={Archive} title={resolved.sessionId} subtitle={`${resolved.source.label} · archived summary`} />
        <div className="card p-4 text-sm text-fg-muted flex items-center gap-2">
          <Archive className="size-4 shrink-0 text-fg-dim" />
          This session&apos;s raw file has been pruned. Its parsed summary remains in Collection, but raw transcript evidence is unavailable.
        </div>
      </div>
    );
  }

  const window = readTranscriptWindow(resolved.file, resolved.spec.format);
  const shown = window.turns.slice(0, RENDER_CAP);
  const totalCounts = {
    all: shown.length,
    chat: shown.filter((turn) => turn.role === "user" || turn.role === "assistant").length,
    tools: shown.filter((turn) => turn.role === "tool" || turn.severity === "error").length,
    errors: shown.filter((turn) => turn.severity === "error").length,
  };
  const errorCount = shown.filter((turn) => turn.severity === "error").length;
  const warnCount = shown.filter((turn) => turn.severity === "warning").length;
  const initialCursor = window.done || !window.nextState ? null : encodeTranscriptCursor({
    v: 1,
    sourceId: resolved.sourceId,
    sessionId: resolved.sessionId,
    file: resolved.file,
    project: resolved.project,
    format: resolved.spec.format,
    parserVersion: PARSER_VERSION,
    descriptorHash: transcriptDescriptorHash(resolved.sourceId, resolved.spec),
    revision: window.revision,
    byteOffset: window.nextByteOffset,
    state: window.nextState,
  });

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      {back}
      <PageHeader
        icon={FileText}
        title={path.basename(resolved.file)}
        subtitle={<span className="mono text-[12px]">{resolved.source.label} · {resolved.sessionId} · {fmtNum(resolved.size)}B on disk · modified {fmtRel(resolved.mtimeMs)}{errorCount > 0 && <span className="text-err"> · {errorCount} errors</span>}{warnCount > 0 && <span className="text-warn"> · {warnCount} warnings</span>}</span>}
      />

      <TranscriptReadingGuide counts={totalCounts} totalTurns={shown.length} />
      <TranscriptClient
        turns={shown}
        sourceId={resolved.sourceId}
        sessionId={resolved.sessionId}
        initialCursor={initialCursor}
        hasMore={initialCursor != null}
        totalTurns={shown.length}
        totalCounts={totalCounts}
        normalization={window.normalization}
      />
      <p className="text-[11px] text-fg-dim mt-3">Transcript windows are capped at {fmtNum(RENDER_CAP)} semantic turns and are bound to the discovered source revision.</p>
    </div>
  );
}

function TranscriptReadingGuide({ counts, totalTurns }: { counts: { all: number; chat: number; tools: number; errors: number }; totalTurns: number }) {
  return (
    <section className="mb-4 rounded-lg border border-accent/25 bg-accent/[0.04] p-3.5" aria-labelledby="transcript-reading-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="transcript-reading-title" className="text-sm font-semibold">Read the conversation first</h2>
          <p className="mt-1 max-w-3xl text-[11px] leading-5 text-fg-muted">OpenEval starts with user and assistant messages so the task and result are easy to follow. Agent reasoning is labeled separately and stays collapsed until requested; tool calls, protocol events, and errors remain available in the filters below without changing the raw transcript.</p>
        </div>
        <span className="shrink-0 rounded-full border border-accent/25 bg-bg px-2 py-1 text-[10px] text-accent-soft mono">{fmtNum(totalTurns)} normalized turns loaded</span>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 sm:max-w-xl">
        <div className="rounded-md border border-bd-subtle bg-bg/70 px-2.5 py-2"><dt className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-fg-dim"><MessageSquare className="size-3" /> Conversation</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{fmtNum(counts.chat)}</dd></div>
        <div className="rounded-md border border-bd-subtle bg-bg/70 px-2.5 py-2"><dt className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-fg-dim"><Wrench className="size-3" /> Tool events</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{fmtNum(counts.tools)}</dd></div>
        <div className="rounded-md border border-bd-subtle bg-bg/70 px-2.5 py-2"><dt className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-fg-dim"><AlertTriangle className="size-3" /> Error signals</dt><dd className={counts.errors > 0 ? "mt-1 text-sm font-semibold tabular-nums text-err" : "mt-1 text-sm font-semibold tabular-nums"}>{fmtNum(counts.errors)}</dd></div>
      </dl>
    </section>
  );
}
