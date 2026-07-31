import fs from "node:fs";
import crypto from "node:crypto";
import { listSourceFiles, parseSessionTranscript } from "../live";
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

// Keep search durable without turning the cache into a transcript mirror.
// Head + tail preserves the task framing and the eventual result/error, which
// is more useful than the old first-100k-only slice on long agent sessions.
export const SEARCH_TEXT_CAP_PER_SIDE = 32_000;
export const SEARCH_QUERY_MAX_CHARS = 512;
export const SEARCH_RESULT_MAX = 200;
const SEARCH_TEXT_HEAD_CAP = SEARCH_TEXT_CAP_PER_SIDE / 2;
const SEARCH_TEXT_GAP = "\n[…]\n";

interface BoundedSearchText {
  head: string;
  tail: string;
  totalChars: number;
}

function appendBoundedText(state: BoundedSearchText, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const chunk = `${state.totalChars > 0 ? "\n" : ""}${trimmed}`;
  state.totalChars += chunk.length;
  const headRoom = Math.max(0, SEARCH_TEXT_HEAD_CAP - state.head.length);
  if (headRoom > 0) state.head += chunk.slice(0, headRoom);
  const remainder = chunk.slice(headRoom);
  if (remainder) {
    const tailCap = SEARCH_TEXT_CAP_PER_SIDE - SEARCH_TEXT_HEAD_CAP - SEARCH_TEXT_GAP.length;
    state.tail = `${state.tail}${remainder}`.slice(-tailCap);
  }
}

function materializeBoundedText(state: BoundedSearchText): string {
  if (state.totalChars <= SEARCH_TEXT_CAP_PER_SIDE) return `${state.head}${state.tail}`;
  return `${state.head}${SEARCH_TEXT_GAP}${state.tail}`;
}

export interface SessionSearchText {
  userText: string;
  assistantText: string;
  title: string;
}

/**
 * Pull conversational text plus bounded tool names/arguments/results out of a
 * transcript. Tool evidence is appended to the assistant-side FTS field so the
 * existing index schema remains compact while queries such as a command, file,
 * MCP tool, or failure output can find the originating session.
 */
export function extractSearchText(file: string): SessionSearchText {
  const user: BoundedSearchText = { head: "", tail: "", totalChars: 0 };
  const assistant: BoundedSearchText = { head: "", tail: "", totalChars: 0 };
  let title = "";
  const add = (side: "u" | "a", text: string) => {
    const t = text.trim();
    if (!t) return;
    if (side === "u") {
      if (!title) title = t.slice(0, 120);
      appendBoundedText(user, t);
    } else appendBoundedText(assistant, t);
  };
  try {
    for (const message of readConversationMessages(file)) {
      add(message.role === "user" ? "u" : "a", message.text);
    }
    const transcript = parseSessionTranscript(file);
    for (const turn of transcript.turns) {
      if (turn.role !== "tool") continue;
      const metadata = [
        turn.tool?.callId ? `call:${turn.tool.callId}` : "",
        turn.tool?.status ? `status:${turn.tool.status}` : "",
        turn.tool?.durationMs != null ? `duration:${turn.tool.durationMs}ms` : "",
      ].filter(Boolean).join(" ");
      appendBoundedText(
        assistant,
        `[${turn.label}]${metadata ? ` ${metadata}` : ""}${turn.preview ? ` ${turn.preview}` : ""}`,
      );
    }
  } catch {
    // Unreadable file → index whatever was collected (possibly nothing).
  }
  return {
    userText: materializeBoundedText(user),
    assistantText: materializeBoundedText(assistant),
    title,
  };
}

interface PendingFile {
  file: string;
  project: string;
  mtime: number;
  sourceId: string;
  contentFingerprint?: string;
}

const FINGERPRINT_SPAN = 4096;

/**
 * Bounded identity for the search input. Stat metadata is intentionally not
 * enough: append-only writers and test fixtures can rewrite a transcript while
 * restoring its mtime and preserving its byte length. The same head/tail
 * boundary used by the collection cache catches the common rewrite without
 * mirroring or streaming the raw transcript again.
 */
function contentFingerprint(file: string, size: number): string | null {
  let fd: number;
  try { fd = fs.openSync(file, "r"); } catch { return null; }
  try {
    const hash = crypto.createHash("sha256");
    if (size <= FINGERPRINT_SPAN * 2) {
      const buffer = Buffer.allocUnsafe(Math.max(0, size));
      const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
      hash.update(buffer.subarray(0, read));
    } else {
      const buffer = Buffer.allocUnsafe(FINGERPRINT_SPAN);
      const head = fs.readSync(fd, buffer, 0, FINGERPRINT_SPAN, 0);
      hash.update(buffer.subarray(0, head));
      const tail = fs.readSync(fd, buffer, 0, FINGERPRINT_SPAN, size - FINGERPRINT_SPAN);
      hash.update(buffer.subarray(0, tail));
    }
    return hash.digest("hex");
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
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
      const sameStat = meta && meta.mtimeMs === st.mtimeMs && meta.size === st.size;
      const fingerprint = sameStat ? contentFingerprint(f.file, st.size) : null;
      // A legacy row without a fingerprint is deliberately treated as a miss
      // when the bounded read succeeds, so every existing index gets upgraded
      // once without changing raw transcript retention.
      if (sameStat && (!fingerprint || meta.contentFingerprint === fingerprint)) continue;
      pending.push({
        file: f.file,
        project: f.project,
        mtime: f.mtime,
        sourceId: def.id,
        ...(fingerprint ? { contentFingerprint: fingerprint } : {}),
      });
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
    const fingerprint = p.contentFingerprint ?? contentFingerprint(p.file, st.size) ?? undefined;
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
      fingerprint,
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
  // The HTTP route rejects oversized input; keep direct callers bounded too so
  // a future caller cannot hand SQLite an arbitrarily large MATCH expression.
  const boundedQuery = q.slice(0, SEARCH_QUERY_MAX_CHARS);
  return {
    hits: ftsSearch(boundedQuery, Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), SEARCH_RESULT_MAX)) : 50),
    index: { indexedFiles: total - pending.length, totalFiles: total },
  };
}
