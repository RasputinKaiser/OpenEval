import fs from "node:fs";
import type { FieldMapping } from "../adapters/generic";
import { hermesJsonToRecords } from "../adapters/hermes";
import { cacheGet, cachePut } from "../live-cache";
import type { KnownFileStat, LiveSession } from "./types";
import { parseLiveSession } from "./parse-claude";
import { parseCodexSession } from "./parse-codex";
import { readFileLines } from "./util";

export function summarizeLiveSessionFile(file: string, projectDir: string, mtime: number, opts: { fields?: FieldMapping; inferredModel?: string; decodeProject?: boolean; stat?: KnownFileStat; forceReparse?: boolean } = {}): LiveSession | null {
  return summarizeWithCache(file, projectDir, mtime, (f, lines, bytes, pd, mt) => parseLiveSession(f, lines, bytes, pd, mt, opts.fields, opts.inferredModel, opts.decodeProject), opts.stat, opts.forceReparse);
}

const HERMES_MAX_BYTES = 32 * 1024 * 1024; // whole-file JSON parse; real sessions are ≤ a few MB

/** Hermes single-JSON sessions, re-emitted as Claude-style records (see adapters/hermes). */
export function summarizeHermesSessionFile(file: string, projectDir: string, mtime: number, stat?: KnownFileStat, forceReparse?: boolean): LiveSession | null {
  return summarizeWithCache(file, projectDir, mtime, (f, lines, bytes, pd, mt) => {
    if (bytes > HERMES_MAX_BYTES) return null;
    // Consume the streaming line reader into an array and join ONCE rather than
    // `raw += line + "\n"` per line: the old accumulator allocated a fresh
    // string (and a cons-string node) on every line, re-materializing the whole
    // file incrementally and defeating the bounded-chunk reader. A Hermes
    // session is a single JSON document, so JSON.parse still needs the full text
    // in one string — but the array/join builds that string in a single pass
    // instead of O(lines) intermediate concatenations. Dropping the per-line
    // trailing "\n" is inert: JSON.parse ignores trailing/leading whitespace.
    const chunks: string[] = [];
    for (const line of lines) chunks.push(line);
    const records = hermesJsonToRecords(chunks.join("\n"));
    if (records.length === 0) return null;
    return parseLiveSession(f, records, bytes, pd, mt, undefined, undefined, false);
  }, stat, forceReparse);
}

const sessionCache = new Map<string, { mtimeMs: number; size: number; session: LiveSession | null }>();
// Must exceed the full-history corpus (~1,500 files today) or sequential
// scans flood the FIFO and every pass falls through to SQLite + JSON.parse:
// at cap 500 a 1,500-file scan ended holding only the oldest 500 entries and
// the next pass got ~0% memory hits. Parsed sessions average ~10KB serialized
// (~30-60MB heap at 4,000) — acceptable for a local dashboard server.
const SESSION_CACHE_LIMIT = 4000;

function summarizeWithCache(
  file: string,
  projectDir: string,
  mtime: number,
  parser: (file: string, lines: Iterable<string>, bytes: number, projectDir: string, mtime: number) => LiveSession | null,
  knownStat?: KnownFileStat,
  forceReparse = false,
): LiveSession | null {
  // Callers coming from the directory walk already stat'd the file; their
  // values are the same ones the mtime sort trusted, so reuse them as the
  // cache key instead of a second syscall per file.
  let st: KnownFileStat;
  if (knownStat) {
    st = knownStat;
  } else {
    try {
      st = fs.statSync(file);
    } catch {
      return null;
    }
  }
  // staleMs is stamped at parse time; cached copies (memory or disk) must not
  // freeze it, so refresh it on every cache hit.
  const refresh = (s: LiveSession | null): LiveSession | null =>
    s ? { ...s, staleMs: Math.max(0, Date.now() - s.lastEventAt) } : s;

  // forceReparse: the caller detected a content rewrite under an unchanged
  // (mtime, size) tuple — both cache tiers key on that tuple, so their rows
  // are stale. Skip them, parse the file, and overwrite both entries below.
  if (!forceReparse) {
    const cached = sessionCache.get(file);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      // Re-insert on hit: Map iteration is insertion-ordered, so this turns the
      // FIFO eviction below into LRU (hits survive a scan that overflows the cap).
      sessionCache.delete(file);
      sessionCache.set(file, cached);
      return refresh(cached.session);
    }
  }
  // Second tier: the persistent SQLite cache survives restarts, so cold
  // full-history scans don't re-parse hundreds of MB of unchanged files.
  const persisted = forceReparse ? null : cacheGet(file, st.mtimeMs, st.size);
  let session: LiveSession | null;
  if (persisted?.hit) {
    session = persisted.session;
  } else {
    try {
      // The file can vanish or become unreadable between statSync and here (log
      // rotation, active session dirs). Skip one file rather than aborting the scan.
      session = parser(file, readFileLines(file), st.size, projectDir, mtime);
    } catch {
      return null;
    }
    cachePut(file, st.mtimeMs, st.size, session);
  }
  if (sessionCache.size >= SESSION_CACHE_LIMIT) {
    const oldest = sessionCache.keys().next().value;
    if (oldest !== undefined) sessionCache.delete(oldest);
  }
  sessionCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, session });
  return refresh(session);
}

export function summarizeCodexSessionFile(file: string, projectDir: string, mtime: number, stat?: KnownFileStat, forceReparse?: boolean): LiveSession | null {
  return summarizeWithCache(file, projectDir, mtime, parseCodexSession, stat, forceReparse);
}
