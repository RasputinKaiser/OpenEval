import test, { after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defToSpec, type CollectionSourceDef } from "../lib/collection/sources";
import type { DiscoveredSource } from "../lib/collection/discover";
import { _setCacheDbForTest } from "../lib/live-cache";
import { collectSourceFiles } from "../lib/live";
import { _setCollectionHooksForTest, scanAllSources } from "../lib/collection/aggregate";
import { indexPendingFiles, searchSessions, _setSearchSourcesForTest } from "../lib/collection/search";

/**
 * Performance-contract tests for the Collection scan (U04):
 *  - a warm rescan with zero changed files must do no full-file re-reads
 *    (proven by counting sequential reads through a patched fs)
 *  - the scan-budget escape hatch returns labeled partial results, never
 *    memoizes them, and resumes via the parse cache
 *  - the FTS index pass is chunked, budget-cancellable, and resumable
 */

// In-memory cache DB keeps parallel test processes off the shared SQLite file.
const cacheDb = new Database(":memory:");
_setCacheDbForTest(cacheDb);

const tempDirs: string[] = [];
function makeCorpus(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  _setCollectionHooksForTest(null);
  _setSearchSourcesForTest(null);
  _setCacheDbForTest(null);
  cacheDb.close();
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** Hooks that mirror discoverKnownSources for one temp-dir source (TTL 0 = revalidate every call). */
function hooksFor(def: CollectionSourceDef) {
  const discover = (): DiscoveredSource[] => {
    const collected = collectSourceFiles(defToSpec(def));
    let lastActivityMs: number | null = null;
    for (const f of collected.files) {
      if (lastActivityMs == null || f.mtime > lastActivityMs) lastActivityMs = f.mtime;
    }
    return [{
      id: def.id, label: def.label, format: def.format, parseable: def.parseable,
      roots: def.roots, presentRoots: def.roots,
      sessionCount: collected.files.length, lastActivityMs,
      status: collected.files.length > 0 ? "present" : "empty",
      collected,
    }];
  };
  return { discover, sources: () => [def], unknown: () => [], fingerprintTtlMs: 0 };
}

function writeSessionFile(dir: string, sessionId: string, iso: string): string {
  const file = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(
    file,
    [
      { type: "system", sessionId, cwd: "/tmp/proj", timestamp: iso },
      { type: "user", timestamp: iso, message: { content: [{ type: "text", text: `find the ledger ${sessionId}` }] } },
      { type: "assistant", timestamp: iso, message: { content: [{ type: "text", text: `The ledger balances for ${sessionId}.` }] } },
      { type: "result", timestamp: iso, duration_ms: 1000, num_turns: 1, usage: { input_tokens: 10, output_tokens: 5 } },
    ].map((l) => JSON.stringify(l)).join("\n"),
    "utf8",
  );
  // Backdate mtime to the event time (as real transcripts have) so ordering
  // and the corpus fingerprint are deterministic.
  fs.utimesSync(file, new Date(iso), new Date(iso));
  return file;
}

/**
 * Count FULL (sequential) transcript reads under `underDir` by patching fs.
 * readFileLines — the only full-file parse path — reads with `position: null`
 * (sequential); the content sentinel reads head/tail with numeric positions.
 * Distinguishing on that keeps the proof exact: a warm rescan may sentinel-
 * probe 8KB per file, but must never stream a whole transcript again.
 */
function trackReads(underDir: string) {
  const realOpen = fs.openSync;
  const realRead = fs.readSync;
  const realClose = fs.closeSync;
  const fdPath = new Map<number, string>();
  const openedFiles = new Set<string>();
  const fullReadFiles = new Set<string>();
  const fsAny = fs as unknown as Record<string, (...args: unknown[]) => unknown>;
  fsAny.openSync = (...args: unknown[]) => {
    const fd = (realOpen as unknown as (...a: unknown[]) => number)(...args);
    const p = args[0];
    if (typeof p === "string" && p.startsWith(underDir)) {
      fdPath.set(fd, p);
      openedFiles.add(p);
    }
    return fd;
  };
  fsAny.readSync = (...args: unknown[]) => {
    const p = fdPath.get(args[0] as number);
    // 5-positional-arg form with position === null → sequential full-file read.
    if (p != null && args.length >= 5 && args[4] === null) fullReadFiles.add(p);
    return (realRead as unknown as (...a: unknown[]) => number)(...args);
  };
  fsAny.closeSync = (...args: unknown[]) => {
    fdPath.delete(args[0] as number);
    return (realClose as unknown as (...a: unknown[]) => void)(...args);
  };
  return {
    openedFiles,
    fullReadFiles,
    restore() {
      fsAny.openSync = realOpen as unknown as (...args: unknown[]) => unknown;
      fsAny.readSync = realRead as unknown as (...args: unknown[]) => unknown;
      fsAny.closeSync = realClose as unknown as (...args: unknown[]) => unknown;
    },
  };
}

test("warm rescan with zero changed files does no full-file re-reads", () => {
  const dir = makeCorpus("openeval-perf-reread-");
  const def: CollectionSourceDef = { id: "perf-reread", label: "Perf Reread", roots: [dir], format: "jsonl-dir", parseable: true };
  _setCollectionHooksForTest(hooksFor(def));
  for (let i = 1; i <= 6; i++) writeSessionFile(dir, `r${i}`, `2026-06-1${i}T09:00:00.000Z`);

  const cold = scanAllSources(10);
  assert.equal(cold.totalParsedSessions, 6, "cold scan parses the whole corpus");

  const tracker = trackReads(dir);
  try {
    // Warm rescan, unchanged corpus: stat-only revalidation serves the memo.
    const warm = scanAllSources(10);
    assert.equal(warm.totalParsedSessions, 6);
    assert.deepEqual([...tracker.fullReadFiles], [], "warm rescan must stream no transcript");
    assert.deepEqual([...tracker.openedFiles], [], "memo-served rescan opens no transcript at all");

    // fresh revalidation re-reads sentinels (bounded head/tail probes) only.
    const fresh = scanAllSources(10, { fresh: true });
    assert.equal(fresh.totalParsedSessions, 6);
    assert.equal(tracker.openedFiles.size, 6, "sentinel pass probes each file");
    assert.deepEqual([...tracker.fullReadFiles], [], "sentinel probes are not full-file reads");

    // Touch exactly one file: only that file is re-read in full.
    const touched = writeSessionFile(dir, "r3", "2026-06-17T09:00:00.000Z");
    const after1 = scanAllSources(10, { fresh: true });
    assert.equal(after1.totalParsedSessions, 6);
    assert.deepEqual([...tracker.fullReadFiles], [touched], "only the changed file is re-parsed");
  } finally {
    tracker.restore();
  }
});

const budgetDir = makeCorpus("openeval-perf-budget-");
const budgetDef: CollectionSourceDef = { id: "perf-budget", label: "Perf Budget", roots: [budgetDir], format: "jsonl-dir", parseable: true };

test("scan budget: exhausted budget yields labeled partial results, never a silent truncation", () => {
  _setCollectionHooksForTest(hooksFor(budgetDef));
  for (let i = 1; i <= 5; i++) writeSessionFile(budgetDir, `b${i}`, `2026-06-2${i}T10:00:00.000Z`);

  // Deadline already expired → nothing parses, everything is labeled.
  const partial = scanAllSources(10, { budgetMs: 0 });
  assert.equal(partial.partial, true);
  assert.deepEqual(partial.partialSources, ["perf-budget"]);
  assert.equal(partial.totalParsedSessions, 0);
  assert.deepEqual(partial.sessions, []);
  const src = partial.sources.find((s) => s.id === "perf-budget");
  assert.ok(src);
  assert.equal(src.scanTruncated, true);
  assert.equal(src.filesFound, 5, "discovery counts stay honest about what exists on disk");
  assert.ok(src.scanWarnings.some((w) => w.includes("scan budget exhausted")), `expected budget warning, got: ${src.scanWarnings}`);

  // The partial result was NOT memoized: an unbudgeted call parses fully.
  const full = scanAllSources(10);
  assert.equal(full.partial, false);
  assert.deepEqual(full.partialSources, []);
  assert.equal(full.totalParsedSessions, 5);
  assert.equal(full.sources.find((s) => s.id === "perf-budget")?.scanTruncated, undefined);

  // With a complete memo, a budgeted call serves the complete snapshot: the
  // budget caps recomputes, it does not degrade cache hits.
  const memoServed = scanAllSources(10, { budgetMs: 0 });
  assert.equal(memoServed.partial, false);
  assert.equal(memoServed.totalParsedSessions, 5);
});

test("scan budget: a generous budget completes, memoizes, and matches the unbudgeted scan", () => {
  writeSessionFile(budgetDir, "b6", "2026-06-27T10:00:00.000Z"); // corpus change → recompute
  const budgeted = scanAllSources(10, { budgetMs: 60_000 });
  assert.equal(budgeted.partial, false);
  assert.equal(budgeted.totalParsedSessions, 6);
  const unbudgeted = scanAllSources(10);
  assert.equal(unbudgeted.totalParsedSessions, 6);
  assert.deepEqual(
    budgeted.sessions.map((s) => s.sessionId),
    unbudgeted.sessions.map((s) => s.sessionId),
    "a completed budgeted scan is byte-for-byte the normal snapshot",
  );
});

test("scan budget: sentinel-dirty rewrites are never cut, and the stale memo is dropped", () => {
  const dir = makeCorpus("openeval-perf-dirty-");
  const def: CollectionSourceDef = { id: "perf-dirty", label: "Perf Dirty", roots: [dir], format: "jsonl-dir", parseable: true };
  _setCollectionHooksForTest(hooksFor(def));
  for (let i = 1; i <= 5; i++) writeSessionFile(dir, `d${i}`, `2026-06-1${i}T12:00:00.000Z`);
  const full = scanAllSources(10);
  assert.equal(full.totalParsedSessions, 5);

  // Rewrite d2's content under an UNCHANGED (mtime, size) tuple — the rewrite
  // class only the content sentinel can see (same-length replacement changes
  // input_tokens 10 → 99, observable in the session item).
  const file = path.join(dir, "d2.jsonl");
  const st = fs.statSync(file);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"input_tokens":10', '"input_tokens":99'), "utf8");
  fs.utimesSync(file, st.atime, st.mtime);
  assert.equal(fs.statSync(file).size, st.size, "rewrite must preserve the stat tuple");

  // Fresh revalidation with an exhausted budget: the dirty file must STILL be
  // re-parsed (its sentinel baseline is already advanced — cutting it would
  // freeze the stale parse forever), while clean files are cut and labeled.
  const partial = scanAllSources(10, { fresh: true, budgetMs: 0 });
  assert.equal(partial.partial, true);
  assert.equal(partial.totalParsedSessions, 1);
  assert.deepEqual(partial.sessions.map((s) => s.sessionId), ["d2"]);
  assert.equal(partial.sessions[0].inputTokens, 99, "the dirty file is served re-parsed, not stale");

  // The pre-rewrite complete memo must have been dropped: an unbudgeted call
  // recomputes (cheap — caches primed) and serves the rewritten content.
  const healed = scanAllSources(10);
  assert.equal(healed.partial, false);
  assert.equal(healed.totalParsedSessions, 5);
  const d2 = healed.sessions.find((s) => s.sessionId === "d2");
  assert.equal(d2?.inputTokens, 99, "memoized snapshot reflects the rewrite");
});

test("/api/collection surfaces the partial flag for budgeted scans", async () => {
  _setCollectionHooksForTest(hooksFor(budgetDef));
  writeSessionFile(budgetDir, "b7", "2026-06-28T10:00:00.000Z"); // corpus change → recompute
  const route = await import("../app/api/collection/route");
  const partialRes = await route.GET(new Request("http://localhost:3000/api/collection?budget_ms=0"));
  assert.equal(partialRes.status, 200);
  const partialBody = await partialRes.json();
  assert.equal(partialBody.partial, true);
  assert.deepEqual(partialBody.partialSources, ["perf-budget"]);

  const fullRes = await route.GET(new Request("http://localhost:3000/api/collection?limit=50"));
  const fullBody = await fullRes.json();
  assert.equal(fullBody.partial, false);
  assert.equal(fullBody.totalParsedSessions, 7);
});

test("FTS index pass is chunked, budget-cancellable, and resumes from persisted meta", () => {
  const dir = makeCorpus("openeval-perf-fts-");
  const def: CollectionSourceDef = { id: "perf-fts", label: "Perf FTS", roots: [dir], format: "jsonl-dir", parseable: true };
  _setSearchSourcesForTest(() => [def]);
  for (let i = 1; i <= 4; i++) writeSessionFile(dir, `f${i}`, `2026-06-1${i}T11:00:00.000Z`);

  // Chunked: a small batch indexes part of the corpus, remaining stays honest.
  const first = indexPendingFiles(2);
  assert.equal(first.indexed, 2);
  assert.equal(first.remaining, 2);
  assert.equal(first.total, 4);
  assert.equal(first.budgetExhausted, false);

  // Cancellable — but never zero-progress: an already-expired budget still
  // indexes one file (a client looping on `remaining` must always advance),
  // then stops with honest remaining.
  const cut = indexPendingFiles(200, { budgetMs: 0 });
  assert.equal(cut.indexed, 1);
  assert.equal(cut.budgetExhausted, true);
  assert.equal(cut.remaining, 1);

  // Resumable: the next pass picks up exactly where the index left off.
  const rest = indexPendingFiles(200);
  assert.equal(rest.indexed, 1);
  assert.equal(rest.remaining, 0);
  assert.equal(rest.budgetExhausted, false);

  // Idempotent: nothing pending → nothing re-indexed.
  const again = indexPendingFiles(200);
  assert.equal(again.indexed, 0);
  assert.equal(again.remaining, 0);

  const res = searchSessions("ledger", 10);
  assert.equal(res.index.indexedFiles, 4);
  assert.equal(res.index.totalFiles, 4);
  assert.ok(res.hits.length >= 1, "indexed text is searchable");
});
