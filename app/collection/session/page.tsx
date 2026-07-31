import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { ArrowLeft, FileText, AlertTriangle, Archive } from "lucide-react";
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

      <TranscriptClient turns={shown} file={file} totalTurns={turns.length} totalCounts={totalCounts} normalization={normalization} />

      {turns.length > RENDER_CAP && (
        <p className="text-[11px] text-fg-dim mt-3">
          Initial render is capped at {fmtNum(RENDER_CAP)} turns; use “Load next” to inspect the rest of this large session.
        </p>
      )}
    </div>
  );
}
