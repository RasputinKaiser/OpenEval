import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-storage-observability-"));
const scratch = path.join(tempBase, "Users", "testoperator", "root");
const dataDir = path.join(scratch, "data");
process.env.OPENEVAL_DATA_ROOT = scratch;

const transcriptPath = path.join(dataDir, "transcripts", "run-1", "case.jsonl");
const workdirPath = path.join(dataDir, "workdirs", "run-1", "case");
const reportPath = path.join(dataDir, "reports", "run-1", "report.md");

fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
fs.mkdirSync(workdirPath, { recursive: true });
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(transcriptPath, "raw transcript retained\n");
fs.writeFileSync(path.join(workdirPath, "artifact.txt"), "evidence");
fs.writeFileSync(reportPath, "# report\n");
fs.writeFileSync(path.join(dataDir, "live-cache.db"), Buffer.alloc(17, 1));
fs.writeFileSync(path.join(dataDir, "settings.json"), "{}\n");

after(() => fs.rmSync(tempBase, { recursive: true, force: true }));

test("storage inventory measures known local areas and retains provenance", async () => {
  const db = await import("../lib/db");
  db.getDbStats();

  const inventory = db.getStorageInventory();
  const entries = new Map(inventory.entries.map((entry) => [entry.id, entry]));
  assert.equal(inventory.complete, true);
  assert.ok(inventory.generatedAt > 0);
  assert.equal(entries.get("transcripts")?.bytes, fs.statSync(transcriptPath).size);
  assert.equal(entries.get("transcripts")?.files, 1);
  assert.match(entries.get("transcripts")?.retention ?? "", /retained independently/);
  assert.equal(entries.get("workdirs")?.files, 1);
  assert.equal(entries.get("reports")?.bytes, fs.statSync(reportPath).size);
  assert.equal(entries.get("live-cache")?.bytes, 17);
  assert.equal(inventory.totalBytes, inventory.entries.reduce((sum, entry) => sum + entry.bytes, 0));
});

test("inventory skips symlink targets and marks the result as a lower bound", async () => {
  const outside = path.join(tempBase, "outside-transcript.txt");
  fs.writeFileSync(outside, "must not be followed");
  fs.symlinkSync(outside, path.join(dataDir, "transcripts", "run-1", "linked.txt"));

  const db = await import("../lib/db");
  const inventory = db.getStorageInventory();
  const transcripts = inventory.entries.find((entry) => entry.id === "transcripts");
  assert.equal(inventory.complete, false);
  assert.equal(transcripts?.status, "partial");
  assert.equal(transcripts?.files, 1);
  assert.ok(inventory.warnings.some((warning) => warning.includes("symbolic link")));
  assert.equal(transcripts?.bytes, fs.statSync(transcriptPath).size);
});

test("maintenance GET exposes inventory with redacted paths and retention text", async () => {
  const route = await import("../app/api/settings/maintenance/route");
  const response = await route.GET(new Request("http://localhost:3000/api/settings/maintenance"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(typeof body.inventory.generatedAt, "number");
  assert.equal(body.inventory.complete, false);
  assert.ok(body.inventory.entries.some((entry: { id: string }) => entry.id === "transcripts"));
  assert.match(JSON.stringify(body.inventory), /Raw transcript JSONL/);
  assert.ok(String(body.inventory.entries.find((entry: { id: string }) => entry.id === "transcripts").path).includes("/Users/[redacted]/"));
  assert.ok(!JSON.stringify(body.inventory).includes("testoperator"));
});

test("cache retains stale archived summaries while bounding and de-duplicating FTS rows", async () => {
  const {
    FTS_INDEX_VERSION,
    FTS_TEXT_CAP_PER_FIELD,
    PARSER_VERSION,
    _setCacheDbForTest,
    cachePut,
    ftsUpsert,
    listCachedSessionsUnder,
  } = await import("../lib/live-cache");
  const conn = new Database(":memory:");
  _setCacheDbForTest(conn);
  try {
    const archivedSummary = {
      sessionId: "archived-summary",
      metricSources: { cost: "missing" },
      usageSegments: [],
      lastEventAt: 1_700_000_000_000,
    } as never;
    cachePut("/archive/old.jsonl", 1, 2, archivedSummary);
    // A parser-version bump must invalidate active reads without evicting the
    // only durable parsed summary available for an archived source.
    conn.prepare("UPDATE session_cache SET parser_version = ? WHERE file = ?").run(PARSER_VERSION - 1, "/archive/old.jsonl");

    const oversized = `head-marker ${"x".repeat(40_000)} tail-marker`;
    const doc = {
      file: "/archive/old.jsonl",
      sourceId: "fixture",
      project: "/tmp/project",
      title: "archived",
      at: 1,
      userText: oversized,
      assistantText: oversized,
    };
    ftsUpsert(doc, 1, 2);
    const stored = conn.prepare("SELECT user_text, assistant_text FROM session_fts").get() as { user_text: string; assistant_text: string };
    assert.equal(stored.user_text.length, FTS_TEXT_CAP_PER_FIELD);
    assert.equal(stored.assistant_text.length, FTS_TEXT_CAP_PER_FIELD);
    assert.match(stored.user_text, /^head-marker/);
    assert.match(stored.user_text, /tail-marker$/);

    const changesBeforeRetry = conn.prepare("SELECT total_changes() AS n").get() as { n: number };
    ftsUpsert(doc, 1, 2);
    const changesAfterRetry = conn.prepare("SELECT total_changes() AS n").get() as { n: number };
    assert.equal(changesAfterRetry.n, changesBeforeRetry.n, "an unchanged explicit reindex must be a no-op");
    const meta = conn.prepare("SELECT index_version FROM fts_meta WHERE file = ?").get("/archive/old.jsonl") as { index_version: number };
    assert.equal(meta.index_version, FTS_INDEX_VERSION);

    const archived = listCachedSessionsUnder(["/archive"]);
    assert.equal(archived.length, 1);
    assert.equal(archived[0].session.sessionId, "archived-summary");
    assert.equal(archived[0].parserVersion, PARSER_VERSION - 1);
  } finally {
    _setCacheDbForTest(null);
    conn.close();
  }
});
