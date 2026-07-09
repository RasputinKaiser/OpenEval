import fs from "node:fs";
import { readFileLines, listSourceFiles } from "../live";
import { allCollectionSources, defToSpec } from "./sources";
import { ftsIndexedFiles, ftsUpsert, ftsSearch, type FtsHit } from "../live-cache";
import { JUDGE_PROMPT_MARKER } from "../insights/signals";

/**
 * Full-text search across every parseable harness's sessions.
 *
 * The FTS5 index lives in live-cache.db and is built incrementally and
 * explicitly (an index pass is a heavy read of every transcript — never part
 * of a page render). Indexed text survives file pruning, so the archive stays
 * searchable after the harness deletes its transcripts.
 */

const TEXT_CAP = 100_000; // chars per side per session — plenty for search, bounded for the DB

const textFromContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is { type: string; text: string } => !!b && typeof b === "object" && (b as { type?: unknown }).type === "text" && typeof (b as { text?: unknown }).text === "string")
    .map((b) => b.text)
    .join(" ");
};

export interface SessionSearchText {
  userText: string;
  assistantText: string;
  title: string;
}

/**
 * Pull all conversational text (user words + assistant prose, no tool noise)
 * out of a transcript, capped. Understands the Claude-projects and Codex
 * shapes; unknown shapes yield whatever text-y fields match.
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
    for (const line of readFileLines(file)) {
      if (!line.trim()) continue;
      if (userText.length >= TEXT_CAP && assistantText.length >= TEXT_CAP) break;
      let obj: Record<string, unknown>;
      try { obj = JSON.parse(line); } catch { continue; }
      const message = obj.message as { content?: unknown } | undefined;
      if (obj.type === "user" && message && !(obj as { isMeta?: boolean }).isMeta) {
        const t = textFromContent(message.content);
        if (t && !t.startsWith("<")) add("u", t); // tool results arrive as "user" turns; skip tag-shaped payloads
      } else if (obj.type === "assistant" && message) {
        add("a", textFromContent(message.content));
      } else if (obj.type === "event_msg") {
        const payload = obj.payload as { type?: string; message?: unknown } | undefined;
        if (payload?.type === "user_message" && typeof payload.message === "string") add("u", payload.message);
        else if (payload?.type === "agent_message" && typeof payload.message === "string") add("a", payload.message);
      }
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

/** Files on disk that are missing from the index or changed since indexing. */
function pendingFiles(): { pending: PendingFile[]; total: number } {
  const indexed = ftsIndexedFiles();
  const pending: PendingFile[] = [];
  let total = 0;
  for (const def of allCollectionSources()) {
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
}

/** One incremental index pass: (re-)index up to `max` pending files, oldest last. */
export function indexPendingFiles(max = 25): IndexProgress {
  const { pending, total } = pendingFiles();
  // Newest first — recent sessions become searchable soonest.
  pending.sort((a, b) => b.mtime - a.mtime);
  const batch = pending.slice(0, Math.max(1, Math.min(max, 200)));
  let indexed = 0;
  for (const p of batch) {
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
  return { indexed, remaining: pending.length - batch.length, total };
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
