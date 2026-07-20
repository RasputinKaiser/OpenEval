import fs from "node:fs";
import { listSourceFiles } from "../live";
import { allCollectionSources, defToSpec } from "./sources";
import { ftsIndexedFiles, ftsUpsert, ftsSearch, type FtsHit } from "../live-cache";
import { JUDGE_PROMPT_MARKER } from "../insights/signals";
import { readConversationMessages } from "./conversation";

/**
 * Full-text search across every parseable harness's sessions.
 *
 * The FTS5 index lives in live-cache.db and is built incrementally and
 * explicitly (an index pass is a heavy read of every transcript — never part
 * of a page render). Indexed text survives file pruning, so the archive stays
 * searchable after the harness deletes its transcripts.
 */

const TEXT_CAP = 100_000; // chars per side per session — plenty for search, bounded for the DB

export interface SessionSearchText {
  userText: string;
  assistantText: string;
  title: string;
}

/**
 * Pull all conversational text (user words + assistant prose, no tool noise)
 * out of a transcript, capped. The shared conversation normalizer understands
 * Claude, both Codex generations, and Hermes single-JSON sessions.
 */
export function extractSearchText(file: string): SessionSearchText {
  let userText = "";
  let assistantText = "";
  let title = "";
  const add = (side: "u" | "a", text: string) => {
    const t = text.trim();
    if (!t) return;
    if (side === "u") {
      if (!title) title = t.slice(0, 120);
      if (userText.length < TEXT_CAP) userText += (userText ? "\n" : "") + t;
    } else if (assistantText.length < TEXT_CAP) {
      assistantText += (assistantText ? "\n" : "") + t;
    }
  };
  try {
    for (const message of readConversationMessages(file)) {
      if (userText.length >= TEXT_CAP && assistantText.length >= TEXT_CAP) break;
      add(message.role === "user" ? "u" : "a", message.text);
    }
  } catch {
    // Unreadable file → index whatever was collected (possibly nothing).
  }
  return { userText: userText.slice(0, TEXT_CAP), assistantText: assistantText.slice(0, TEXT_CAP), title };
}

interface PendingFile {
  file: string;
  project: string;
  mtime: number;
  sourceId: string;
}

/**
 * Test seam (the `_setCollectionHooksForTest` pattern): the real source
 * registry points at fixed home-dir roots, so index/budget behavior is only
 * testable against injected temp-dir sources.
 */
let sourcesHook: (() => ReturnType<typeof allCollectionSources>) | null = null;

export function _setSearchSourcesForTest(fn: (() => ReturnType<typeof allCollectionSources>) | null): void {
  sourcesHook = fn;
}

/** Files on disk that are missing from the index or changed since indexing. */
function pendingFiles(): { pending: PendingFile[]; total: number } {
  const indexed = ftsIndexedFiles();
  const pending: PendingFile[] = [];
  let total = 0;
  for (const def of (sourcesHook ?? allCollectionSources)()) {
    if (!def.parseable) continue;
    for (const f of listSourceFiles(defToSpec(def))) {
      total++;
      let st: fs.Stats;
      try { st = fs.statSync(f.file); } catch { continue; }
      const meta = indexed.get(f.file);
      if (meta && meta.mtimeMs === st.mtimeMs && meta.size === st.size) continue;
      pending.push({ file: f.file, project: f.project, mtime: f.mtime, sourceId: def.id });
    }
  }
  return { pending, total };
}

export interface IndexProgress {
  indexed: number; // this call
  remaining: number;
  total: number; // files on disk across sources
  /**
   * True when this pass stopped on its time budget before finishing its batch.
   * `remaining` stays honest either way — the client's resume loop (POST while
   * remaining > 0) needs no special handling.
   */
  budgetExhausted: boolean;
}

/**
 * One incremental index pass: (re-)index up to `max` pending files, newest
 * first. Each file is its own small write transaction (see ftsUpsert), so an
 * index pass never holds the WAL writer across more than one transcript —
 * chunking and cancellation both fall out of that granularity: `budgetMs`
 * bounds a pass's wall time between files, a client that stops POSTing stops
 * the rebuild, and the next pass resumes from the persisted fts_meta cursor.
 */
export function indexPendingFiles(max = 25, opts: { budgetMs?: number } = {}): IndexProgress {
  const deadline = opts.budgetMs != null ? Date.now() + opts.budgetMs : null;
  const { pending, total } = pendingFiles();
  // Newest first — recent sessions become searchable soonest.
  pending.sort((a, b) => b.mtime - a.mtime);
  const batch = pending.slice(0, Math.max(1, Math.min(max, 200)));
  let indexed = 0;
  let attempted = 0;
  let budgetExhausted = false;
  for (const p of batch) {
    // Deadline check AFTER the first file: a pass must always make forward
    // progress, or a client looping on `remaining` (with the route's default
    // budget applied) could spin forever when the pending walk alone eats the
    // budget on a huge corpus.
    if (deadline != null && attempted > 0 && Date.now() >= deadline) {
      budgetExhausted = true;
      break;
    }
    attempted++;
    let st: fs.Stats;
    try { st = fs.statSync(p.file); } catch { continue; }
    let text = extractSearchText(p.file);
    // Judge stubs are instrumentation, not user work — index them empty so
    // they can never match a search but don't stay "pending" forever.
    if (text.userText.startsWith(JUDGE_PROMPT_MARKER)) text = { userText: "", assistantText: "", title: "" };
    ftsUpsert(
      {
        file: p.file,
        sourceId: p.sourceId,
        project: p.project,
        title: text.title,
        at: p.mtime,
        userText: text.userText,
        assistantText: text.assistantText,
      },
      st.mtimeMs,
      st.size,
    );
    indexed++;
  }
  return { indexed, remaining: pending.length - attempted, total, budgetExhausted };
}

export interface SearchResponse {
  hits: FtsHit[];
  index: { indexedFiles: number; totalFiles: number };
}

export function searchSessions(q: string, limit = 50): SearchResponse {
  const { pending, total } = pendingFiles();
  return {
    hits: ftsSearch(q, limit),
    index: { indexedFiles: total - pending.length, totalFiles: total },
  };
}
