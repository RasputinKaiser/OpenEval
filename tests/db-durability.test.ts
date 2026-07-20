import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Durability tests for lib/db.ts (eval.db):
 *  - a corrupt DB file is moved aside (.corrupt-<ts>) and recreated, not a crash loop
 *  - the recovery is surfaced as an API-visible notice, with paths redacted
 *  - schema_version formalizes migrate()
 *  - /api/settings/maintenance serves stats + integrity/checkpoint/vacuum, local Hosts only
 *
 * lib/config resolves OPENEVAL_DATA_ROOT at import time, so the env var is
 * pointed at a private mkdtemp dir BEFORE any dynamic import below — this
 * process must never open the shared .test-data DB (vacuum/checkpoint here
 * would race parallel test processes) or, worse, a real data/ DB.
 */
const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-db-durability-"));
// The data root deliberately contains a `/Users/<name>/` segment so the API
// redaction assertions below are meaningful on any host (os.tmpdir() itself
// has no user segment on macOS/Linux CI — without this, the redaction check
// would pass vacuously whether or not the route redacts).
const scratch = path.join(tempBase, "Users", "testoperator", "root");
process.env.OPENEVAL_DATA_ROOT = scratch;
const dataDir = path.join(scratch, "data");
const dbPath = path.join(dataDir, "eval.db");

// Planted before the first import of lib/db: this process's one recovery
// attempt is spent on a deliberately corrupted eval.db.
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(dbPath, "this is not a sqlite database, not even close");
fs.writeFileSync(dbPath + "-wal", "garbage wal");

after(() => {
  fs.rmSync(tempBase, { recursive: true, force: true });
});

async function importDb() {
  return import("../lib/db");
}

async function importRoute() {
  return import("../app/api/settings/maintenance/route");
}

function makeRun(dbmod: Awaited<ReturnType<typeof importDb>>, id: string) {
  dbmod.insertRun({
    id,
    name: "durability run",
    status: "completed",
    created_at: Date.now(),
    ended_at: Date.now(),
    params: { runner: "headless", parallel: 1 } as any,
    summary: null,
  } as any);
}

test("corrupt eval.db is moved aside and recreated — recovery, not crash", async () => {
  const dbmod = await importDb();
  // First touch of the DB: would previously throw SQLITE_NOTADB forever.
  makeRun(dbmod, "run-recovered");
  assert.deepEqual(dbmod.listRuns().map((r) => r.id), ["run-recovered"]);

  const names = fs.readdirSync(dataDir);
  assert.ok(names.some((n) => n.startsWith("eval.db.corrupt-")), `corrupt file kept for forensics, got: ${names}`);
  assert.ok(names.includes("eval.db"), "fresh DB created in place");
  // The planted garbage WAL must not survive as the fresh DB's WAL — it is
  // either renamed aside (best-effort) or discarded by SQLite on close; a
  // clean quick_check on the fresh DB proves nothing was inherited.
  const wal = path.join(dataDir, "eval.db-wal");
  if (fs.existsSync(wal)) {
    assert.notEqual(fs.readFileSync(wal, "utf8"), "garbage wal", "fresh DB must not inherit the corrupt WAL");
  }

  const notice = dbmod.getDbRecoveryNotice();
  assert.ok(notice, "recovery must be surfaced, not silent");
  assert.ok(notice!.movedAsideTo.includes("eval.db.corrupt-"));
  assert.ok(notice!.at > 0);
  assert.ok(notice!.reason.length > 0);
});

test("schema_version table formalizes migrations", async () => {
  const dbmod = await importDb();
  assert.ok(dbmod.SCHEMA_VERSION >= 1);
  assert.equal(dbmod.getSchemaVersion(), dbmod.SCHEMA_VERSION);
  const rows = dbmod.getDb()
    .prepare("SELECT version FROM schema_version ORDER BY version").pluck().all() as number[];
  assert.deepEqual(rows, Array.from({ length: dbmod.SCHEMA_VERSION }, (_, i) => i + 1));
  // Legacy marker stays in sync for older checkouts sharing the same DB file.
  assert.equal(Number(dbmod.getDb().pragma("user_version", { simple: true })), dbmod.SCHEMA_VERSION);
});

test("maintenance helpers: integrity ok, checkpoint truncates WAL, vacuum runs", async () => {
  const dbmod = await importDb();
  const integrity = dbmod.checkDbIntegrity();
  assert.equal(integrity.ok, true, `expected clean quick_check, got: ${integrity.messages}`);
  assert.equal(dbmod.checkDbIntegrity(true).ok, true);

  makeRun(dbmod, "run-wal");
  const cp = dbmod.walCheckpointTruncate();
  assert.equal(cp.busy, 0);
  assert.ok(!fs.existsSync(dbPath + "-wal") || fs.statSync(dbPath + "-wal").size === 0, "TRUNCATE leaves an empty WAL");

  dbmod.vacuumDb();
  assert.equal(dbmod.checkDbIntegrity().ok, true);

  const stats = dbmod.getDbStats();
  assert.ok(stats.sizeBytes > 0);
  assert.ok(stats.pageSizeBytes > 0 && stats.pageCount > 0);
  assert.equal(stats.journalMode, "wal");
  assert.equal(stats.schemaVersion, dbmod.SCHEMA_VERSION);
  assert.ok(stats.tables.runs >= 2);
  assert.ok(stats.recovery, "stats carry the recovery notice");
});

test("GET /api/settings/maintenance returns stats for local Hosts", async () => {
  const route = await importRoute();
  const res = await route.GET(new Request("http://localhost:3000/api/settings/maintenance"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.db.sizeBytes > 0);
  assert.equal(body.db.journalMode, "wal");
  assert.equal(typeof body.db.tables.runs, "number");
  assert.ok(body.db.recovery, "recovery notice is API-visible");
  assert.ok(String(body.db.recovery.movedAsideTo).includes("eval.db.corrupt-"));
  // Redaction defaults ON. The scratch data root embeds /Users/testoperator/,
  // so the raw paths verifiably contain a user segment the route must scrub.
  assert.ok(body.db.path.includes("/Users/[redacted]/"), `path not redacted: ${body.db.path}`);
  assert.ok(!body.db.path.includes("testoperator"));
  assert.ok(String(body.db.recovery.movedAsideTo).includes("/Users/[redacted]/"));
  const raw = JSON.stringify(body);
  assert.ok(!raw.includes("testoperator"), `unredacted user path in: ${raw}`);
});

test("maintenance endpoint rejects non-local Hosts (GET and POST)", async () => {
  const route = await importRoute();
  const viaHeader = new Request("http://localhost:3000/api/settings/maintenance", {
    headers: { host: "evil.example" },
  });
  assert.equal((await route.GET(viaHeader)).status, 403);

  const viaUrl = new Request("http://evil.example/api/settings/maintenance");
  assert.equal((await route.GET(viaUrl)).status, 403);

  const post = new Request("http://evil.example/api/settings/maintenance", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "vacuum" }),
  });
  assert.equal((await route.POST(post)).status, 403);
});

test("POST /api/settings/maintenance actions", async () => {
  const route = await importRoute();
  const post = (body: unknown) =>
    route.POST(new Request("http://localhost:3000/api/settings/maintenance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));

  const integrity = await (await post({ action: "integrity_check" })).json();
  assert.equal(integrity.ok, true);
  assert.deepEqual(integrity.messages, []);

  const checkpoint = await (await post({ action: "checkpoint" })).json();
  assert.equal(checkpoint.ok, true);
  assert.equal(typeof checkpoint.result.busy, "number");

  const vacuum = await (await post({ action: "vacuum" })).json();
  assert.equal(vacuum.ok, true);
  assert.ok(vacuum.sizeAfter > 0);

  const bad = await post({ action: "drop_all_tables" });
  assert.equal(bad.status, 400);
  const missing = await post({});
  assert.equal(missing.status, 400);
});

test("healthy DB opens without a recovery notice or moved-aside files", () => {
  // Recovery state is per-process and this process already spent it — a clean
  // open needs its own process with its own scratch data root.
  const clean = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-db-clean-"));
  try {
    const script = `
      const db = require(${JSON.stringify(path.join(__dirname, "..", "lib", "db.ts"))});
      db.getDb();
      const stats = db.getDbStats();
      console.log(JSON.stringify({
        notice: db.getDbRecoveryNotice(),
        schemaVersion: stats.schemaVersion,
        journalMode: stats.journalMode,
      }));
    `;
    const out = execFileSync(process.execPath, ["--import", "tsx", "-e", script], {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, OPENEVAL_DATA_ROOT: clean },
      encoding: "utf8",
    });
    const parsed = JSON.parse(out.trim());
    assert.equal(parsed.notice, null);
    assert.ok(parsed.schemaVersion >= 1);
    assert.equal(parsed.journalMode, "wal");
    const names = fs.readdirSync(path.join(clean, "data"));
    assert.ok(!names.some((n) => n.includes(".corrupt-")), `no corruption artifacts on a healthy open: ${names}`);
  } finally {
    fs.rmSync(clean, { recursive: true, force: true });
  }
});
