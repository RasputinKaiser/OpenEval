import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defToSpec, type CollectionSourceDef } from "../lib/collection/sources";
import type { DiscoveredSource } from "../lib/collection/discover";
import { _setCacheDbForTest } from "../lib/live-cache";
import { collectSourceFiles } from "../lib/live";
import { _setCollectionHooksForTest, type CollectionSessionItem } from "../lib/collection/aggregate";

// Every scan goes through the live-cache; an in-memory DB keeps parallel test
// processes off the shared .test-data SQLite cache.
const cacheDb = new Database(":memory:");
_setCacheDbForTest(cacheDb);

const corpusDir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-collection-route-"));
const sourceDef: CollectionSourceDef = { id: "route-src", label: "Route Src", roots: [corpusDir], format: "jsonl-dir", parseable: true };

/** Hooks that mirror discoverKnownSources for one temp-dir source. */
function routeTestHooks(def: CollectionSourceDef) {
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
  return { discover, sources: () => [def], unknown: () => [], fingerprintTtlMs: 60_000 };
}

function writeSessionFile(sessionId: string, iso: string): void {
  const file = path.join(corpusDir, `${sessionId}.jsonl`);
  fs.writeFileSync(
    file,
    [
      { type: "system", sessionId, cwd: "/tmp/proj", timestamp: iso },
      { type: "assistant", timestamp: iso, message: { content: [{ type: "text", text: `done ${sessionId}` }] } },
      { type: "result", timestamp: iso, duration_ms: 1000, num_turns: 1, usage: { input_tokens: 10, output_tokens: 5 } },
    ].map((l) => JSON.stringify(l)).join("\n"),
    "utf8",
  );
  // lastEventAt is max(file mtime, latest event ts) — backdate the mtime to the
  // event time (as real transcripts have) so lastEventAt is deterministic.
  fs.utimesSync(file, new Date(iso), new Date(iso));
}

// Newest-first order after the sort is s7, s6, …, s1.
const ALL_IDS = ["s7", "s6", "s5", "s4", "s3", "s2", "s1"];
before(() => {
  for (let i = 1; i <= 7; i++) {
    writeSessionFile(`s${i}`, `2026-06-2${i}T12:00:00.000Z`);
  }
  _setCollectionHooksForTest(routeTestHooks(sourceDef));
});

after(() => {
  _setCollectionHooksForTest(null);
  _setCacheDbForTest(null);
  cacheDb.close();
  fs.rmSync(corpusDir, { recursive: true, force: true });
});

// Route import is dynamic so hooks and the temp corpus exist before any scan.
async function getCollection(query: string): Promise<Response> {
  const route = await import("../app/api/collection/route");
  return route.GET(new Request(`http://localhost:3000/api/collection${query}`));
}

function identity(s: CollectionSessionItem): string {
  return s.path ?? s.sessionId;
}

test("?limit= response keeps its full-aggregate shape and gains nextCursor", async () => {
  const res = await getCollection("?limit=3");
  assert.equal(res.status, 200);
  const body = await res.json();
  // Existing consumers' fields are all still present.
  assert.ok(Array.isArray(body.sources));
  assert.ok(Array.isArray(body.byModel));
  assert.ok(Array.isArray(body.byTool));
  assert.equal(typeof body.generatedAtMs, "number");
  assert.equal(body.totalParsedSessions, 7);
  assert.equal(body.sessions.length, 3);
  assert.deepEqual(body.sessions.map((s: CollectionSessionItem) => s.sessionId), ["s7", "s6", "s5"]);
  assert.equal(typeof body.nextCursor, "string", "a truncated list must carry a continuation cursor");

  // A limit that covers the whole corpus is exhausted: nextCursor is null.
  const all = await (await getCollection("?limit=100")).json();
  assert.equal(all.sessions.length, 7);
  assert.equal(all.nextCursor, null);
});

test("cursor page-walk unions to exactly the corpus with no duplicates", async () => {
  const first = await (await getCollection("?limit=2")).json();
  const seen: string[] = first.sessions.map(identity);
  let cursor: string | null = first.nextCursor;
  let pages = 0;
  while (cursor !== null) {
    assert.ok(pages < 20, "cursor walk must terminate");
    const res = await getCollection(`?cursor=${encodeURIComponent(cursor)}&page=2`);
    assert.equal(res.status, 200);
    const page = await res.json();
    assert.ok(page.sessions.length <= 2);
    // Cursor pages are sessions-only — no stats/rollups on the wire.
    assert.equal(page.sources, undefined);
    assert.equal(page.byModel, undefined);
    assert.equal(page.totalParsedSessions, 7);
    seen.push(...page.sessions.map(identity));
    cursor = page.nextCursor;
    pages++;
  }
  assert.equal(new Set(seen).size, seen.length, "no duplicates across pages");
  assert.deepEqual(
    seen.map((p) => path.basename(p, ".jsonl")),
    ALL_IDS,
    "union of all pages is the whole corpus, newest first",
  );
});

test("the same cursor over an unchanged snapshot returns an identical page", async () => {
  const first = await (await getCollection("?limit=3")).json();
  const a = await (await getCollection(`?cursor=${encodeURIComponent(first.nextCursor)}&page=3`)).json();
  const b = await (await getCollection(`?cursor=${encodeURIComponent(first.nextCursor)}&page=3`)).json();
  assert.deepEqual(a.sessions.map(identity), b.sessions.map(identity));
  assert.equal(a.nextCursor, b.nextCursor);
  assert.deepEqual(a.sessions.map((s: CollectionSessionItem) => s.sessionId), ["s4", "s3", "s2"]);
});

test("a vanished cursor falls back to the first strictly-older item", async () => {
  // Cursor identity that no longer exists, positioned at s5's timestamp:
  // the walk must resume at the first item with lastEventAt < t (s4).
  const t = Date.parse("2026-06-25T12:00:00.000Z");
  const ghost = Buffer.from(JSON.stringify({ t, id: "no-such-session" }), "utf8").toString("base64url");
  const res = await getCollection(`?cursor=${encodeURIComponent(ghost)}&page=2`);
  assert.equal(res.status, 200);
  const page = await res.json();
  assert.deepEqual(page.sessions.map((s: CollectionSessionItem) => s.sessionId), ["s4", "s3"]);
  assert.equal(typeof page.nextCursor, "string");

  // Older than everything → empty page, exhausted.
  const past = Buffer.from(JSON.stringify({ t: 0, id: "no-such-session" }), "utf8").toString("base64url");
  const empty = await (await getCollection(`?cursor=${encodeURIComponent(past)}&page=2`)).json();
  assert.deepEqual(empty.sessions, []);
  assert.equal(empty.nextCursor, null);
});

test("malformed cursors are a 400 with a JSON error", async () => {
  for (const bad of ["garbage!!", "", Buffer.from("{\"nope\":1}").toString("base64url"), Buffer.from("[1,2]").toString("base64url")]) {
    const res = await getCollection(`?cursor=${encodeURIComponent(bad)}&page=2`);
    assert.equal(res.status, 400, `cursor ${JSON.stringify(bad)} must be rejected`);
    const body = await res.json();
    assert.equal(typeof body.error, "string");
  }
});

test("page size is clamped to 1..500 and defaults on junk", async () => {
  const first = await (await getCollection("?limit=1")).json();
  const cursor = encodeURIComponent(first.nextCursor);
  const clampedLow = await (await getCollection(`?cursor=${cursor}&page=0`)).json();
  assert.equal(clampedLow.sessions.length, 1);
  const clampedJunk = await (await getCollection(`?cursor=${cursor}&page=nope`)).json();
  assert.equal(clampedJunk.sessions.length, 6, "junk page falls back to the default and returns the rest");
  const clampedHigh = await (await getCollection(`?cursor=${cursor}&page=9999`)).json();
  assert.equal(clampedHigh.sessions.length, 6);
  assert.equal(clampedHigh.nextCursor, null);
});
