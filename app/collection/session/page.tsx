import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { ArrowLeft, FileText, AlertTriangle, Archive, MessageSquare, Wrench } from "lucide-react";
import { parseSessionTranscript } from "@/lib/live";
import { isPathInAnyCollectionSource } from "@/lib/collection/sources";
import { fmtNum, fmtRel } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import TranscriptClient from "@/components/TranscriptClient";
import { RedactedPath } from "@/components/RedactToggle";

export const dynamic = "force-dynamic";

/** Keep the initial RSC/HTML payload small; later windows are user-triggered. */
const RENDER_CAP = 240;

/**
 * Read-only transcript viewer for ANY discovered session (search hits, the
 * Collection tables). The file path comes from the URL, so it is only honored
 * when it sits inside a known collection source root.
 */
export default async function SessionViewerPage({ searchParams }: { searchParams?: Promise<{ file?: string }> }) {
  const file = (await searchParams)?.file ?? "";
  const back = (
    <Link href="/collection" className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg mb-2">
      <ArrowLeft className="size-3.5" /> Collection
    </Link>
  );

  if (!file || !path.isAbsolute(file) || !isPathInAnyCollectionSource(file)) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        {back}
        <div className="card p-4 text-sm text-err flex items-center gap-2">
          <AlertTriangle className="size-4 shrink-0" />
          {file ? "That path is not inside any known harness's session directory." : "No session file given."}
        </div>
      </div>
    );
  }

  let st: fs.Stats | null = null;
  try { st = fs.statSync(file); } catch {}

  if (!st) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        {back}
        <PageHeader icon={Archive} title={path.basename(file)} subtitle={<RedactedPath path={file} className="mono text-[12px]" />} />
        <div className="card p-4 text-sm text-fg-muted flex items-center gap-2">
          <Archive className="size-4 shrink-0 text-fg-dim" />
          This session&apos;s file has been pruned from disk. Its parsed summary lives on in the archive (Collection totals, Timeline), but the full transcript is gone.
        </div>
      </div>
    );
  }

  const { turns, error, normalization } = parseSessionTranscript(file);
  const shown = turns.slice(0, RENDER_CAP);
  const totalCounts = {
    all: turns.length,
    chat: turns.filter((t) => t.role === "user" || t.role === "assistant").length,
    tools: turns.filter((t) => t.role === "tool" || t.severity === "error").length,
    errors: turns.filter((t) => t.severity === "error").length,
  };
  const errorCount = turns.filter((t) => t.severity === "error").length;
  const warnCount = turns.filter((t) => t.severity === "warning").length;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      {back}
      <PageHeader
        icon={FileText}
        title={path.basename(file)}
        subtitle={
          <span className="mono text-[12px]">
            <RedactedPath path={file} /> · {fmtNum(st.size)}B on disk · modified {fmtRel(st.mtimeMs)} · {fmtNum(turns.length)} normalized turns
            {errorCount > 0 && <span className="text-err"> · {errorCount} errors</span>}
            {warnCount > 0 && <span className="text-warn"> · {warnCount} warnings</span>}
          </span>
        }
      />

      {error && <div className="card p-3 mb-4 text-sm text-err flex items-center gap-2"><AlertTriangle className="size-4" /> {error}</div>}

      <TranscriptReadingGuide counts={totalCounts} totalTurns={turns.length} />

      <TranscriptClient turns={shown} file={file} totalTurns={turns.length} totalCounts={totalCounts} normalization={normalization} />

      {turns.length > RENDER_CAP && (
        <p className="text-[11px] text-fg-dim mt-3">
          Initial render is capped at {fmtNum(RENDER_CAP)} turns; use “Load next” to inspect the rest of this large session.
        </p>
      )}
    </div>
  );
}

function TranscriptReadingGuide({
  counts,
  totalTurns,
}: {
  counts: { all: number; chat: number; tools: number; errors: number };
  totalTurns: number;
}) {
  return (
    <section className="mb-4 rounded-lg border border-accent/25 bg-accent/[0.04] p-3.5" aria-labelledby="transcript-reading-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="transcript-reading-title" className="text-sm font-semibold">Read the conversation first</h2>
          <p className="mt-1 max-w-3xl text-[11px] leading-5 text-fg-muted">
            OpenEval starts with user and assistant messages so the task and result are easy to follow. Agent reasoning is labeled separately and stays collapsed until requested; tool calls, protocol events, and errors remain available in the filters below without changing the raw transcript.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-accent/25 bg-bg px-2 py-1 text-[10px] text-accent-soft mono">
          {fmtNum(totalTurns)} normalized turns
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 sm:max-w-xl">
        <div className="rounded-md border border-bd-subtle bg-bg/70 px-2.5 py-2">
          <dt className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-fg-dim"><MessageSquare className="size-3" /> Conversation</dt>
          <dd className="mt-1 text-sm font-semibold tabular-nums">{fmtNum(counts.chat)}</dd>
        </div>
        <div className="rounded-md border border-bd-subtle bg-bg/70 px-2.5 py-2">
          <dt className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-fg-dim"><Wrench className="size-3" /> Tool events</dt>
          <dd className="mt-1 text-sm font-semibold tabular-nums">{fmtNum(counts.tools)}</dd>
        </div>
        <div className="rounded-md border border-bd-subtle bg-bg/70 px-2.5 py-2">
          <dt className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-fg-dim"><AlertTriangle className="size-3" /> Error signals</dt>
          <dd className={counts.errors > 0 ? "mt-1 text-sm font-semibold tabular-nums text-err" : "mt-1 text-sm font-semibold tabular-nums"}>{fmtNum(counts.errors)}</dd>
        </div>
      </dl>
    </section>
  );
}
