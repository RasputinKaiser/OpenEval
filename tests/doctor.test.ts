import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  checkBetterSqlite3,
  checkDatabase,
  checkDiskHeadroom,
  checkNextCache,
  checkNodeVersion,
  checkPort3000,
  runDoctor,
} from "../scripts/doctor";

/**
 * Doctor checks run against throwaway temp fixture directories only — never
 * the operator's real checkout or `data/`. The database check must stay
 * strictly read-only, which is asserted byte-for-byte below.
 */

function tmpdir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeHealthyCheckout(root: string, nodeMajor: number): void {
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "fixture", engines: { node: ">=20" } })
  );
  fs.writeFileSync(path.join(root, ".nvmrc"), `${nodeMajor}\n`);
}

const CURRENT_MAJOR = Number.parseInt(process.versions.node.split(".")[0], 10);

test("node version: ok when current major matches .nvmrc and engines floor", () => {
  const root = tmpdir("doctor-node-ok-");
  try {
    writeHealthyCheckout(root, 20);
    const r = checkNodeVersion(root, "20.11.1");
    assert.equal(r.status, "ok");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("node version: warns on .nvmrc major mismatch with rebuild hint", () => {
  const root = tmpdir("doctor-node-warn-");
  try {
    writeHealthyCheckout(root, 20);
    const r = checkNodeVersion(root, "23.1.0");
    assert.equal(r.status, "warn");
    assert.match(r.hint ?? "", /rebuild better-sqlite3/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("node version: fails below the engines floor", () => {
  const root = tmpdir("doctor-node-fail-");
  try {
    writeHealthyCheckout(root, 20);
    const r = checkNodeVersion(root, "18.2.0");
    assert.equal(r.status, "fail");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("better-sqlite3: loads on a healthy environment", async () => {
  const r = await checkBetterSqlite3();
  assert.equal(r.status, "ok");
});

test(".next: absent cache is healthy", () => {
  const root = tmpdir("doctor-next-none-");
  try {
    writeHealthyCheckout(root, CURRENT_MAJOR);
    assert.equal(checkNextCache(root).status, "ok");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test(".next: complete cache newer than config inputs is healthy", () => {
  const root = tmpdir("doctor-next-ok-");
  try {
    writeHealthyCheckout(root, CURRENT_MAJOR);
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(root, "package.json"), old, old);
    fs.mkdirSync(path.join(root, ".next"));
    fs.writeFileSync(path.join(root, ".next", "BUILD_ID"), "abc123");
    fs.writeFileSync(path.join(root, ".next", "build-manifest.json"), "{}");
    assert.equal(checkNextCache(root).status, "ok");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test(".next: deliberately staled cache is flagged with a clear hint", () => {
  const root = tmpdir("doctor-next-stale-");
  try {
    writeHealthyCheckout(root, CURRENT_MAJOR);
    fs.mkdirSync(path.join(root, ".next"));
    const marker = path.join(root, ".next", "build-manifest.json");
    fs.writeFileSync(marker, "{}");
    const old = new Date(Date.now() - 3_600_000);
    fs.utimesSync(marker, old, old);
    // Config input changed after the cache was written — the stale-chunk class.
    fs.writeFileSync(path.join(root, "next.config.js"), "module.exports = {};\n");
    const r = checkNextCache(root);
    assert.equal(r.status, "warn");
    assert.match(r.detail, /Stale \.next cache/);
    assert.match(r.detail, /next\.config\.js/);
    assert.match(r.hint ?? "", /rm -rf \.next/);
    // Flagging must not itself mutate anything.
    assert.equal(fs.existsSync(marker), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test(".next: BUILD_ID without a build manifest is an incomplete prod build", () => {
  const root = tmpdir("doctor-next-partial-");
  try {
    writeHealthyCheckout(root, CURRENT_MAJOR);
    fs.mkdirSync(path.join(root, ".next"));
    fs.writeFileSync(path.join(root, ".next", "BUILD_ID"), "abc123");
    const r = checkNextCache(root);
    assert.equal(r.status, "warn");
    assert.match(r.detail, /Incomplete \.next cache/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test(".next: incomplete cache (no manifest) is flagged; --fix clears it", () => {
  const root = tmpdir("doctor-next-incomplete-");
  try {
    writeHealthyCheckout(root, CURRENT_MAJOR);
    fs.mkdirSync(path.join(root, ".next", "static"), { recursive: true });
    const flagged = checkNextCache(root);
    assert.equal(flagged.status, "warn");
    assert.match(flagged.detail, /Incomplete \.next cache/);

    const fixed = checkNextCache(root, { fix: true });
    assert.equal(fixed.status, "warn");
    assert.match(fixed.detail, /cleared via --fix/);
    assert.equal(fs.existsSync(path.join(root, ".next")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("database: missing file is a skip, and is not created", async () => {
  const root = tmpdir("doctor-db-missing-");
  try {
    const dbPath = path.join(root, "data", "eval.db");
    const r = await checkDatabase(dbPath);
    assert.equal(r.status, "skip");
    assert.equal(fs.existsSync(dbPath), false, "read-only check must never create the database");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("database: healthy db passes quick_check without being modified", async () => {
  const root = tmpdir("doctor-db-ok-");
  try {
    const dbPath = path.join(root, "eval.db");
    const db = new Database(dbPath);
    db.exec("create table t (id integer primary key, v text); insert into t (v) values ('x');");
    db.close();
    const before = fs.readFileSync(dbPath);

    const r = await checkDatabase(dbPath);
    assert.equal(r.status, "ok");
    const after = fs.readFileSync(dbPath);
    assert.equal(before.equals(after), true, "quick_check must leave the database bytes untouched");
    assert.equal(fs.existsSync(`${dbPath}-wal`), false, "read-only probe must not leave a WAL behind");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("database: quiescent WAL-mode db passes without creating sidecars in its directory", async () => {
  // The real data/eval.db runs in WAL mode (lib/db.ts). A naive readonly open
  // would create eval.db-shm/-wal next to it — i.e. write into data/. The
  // doctor must check a temp copy instead and leave the directory untouched.
  const root = tmpdir("doctor-db-wal-");
  try {
    const dbPath = path.join(root, "eval.db");
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec("create table t (id integer primary key, v text); insert into t (v) values ('x');");
    db.close(); // checkpoints and removes -wal/-shm
    const before = fs.readFileSync(dbPath);
    assert.deepEqual(fs.readdirSync(root), ["eval.db"], "fixture must start quiescent");

    const r = await checkDatabase(dbPath);
    assert.equal(r.status, "ok");
    assert.deepEqual(
      fs.readdirSync(root),
      ["eval.db"],
      "doctor must not create -shm/-wal sidecars next to a quiescent WAL database"
    );
    assert.equal(before.equals(fs.readFileSync(dbPath)), true, "database bytes must be untouched");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("database: in-use WAL db (sidecars present) is checked in place, creating nothing new", async () => {
  const root = tmpdir("doctor-db-wal-live-");
  const dbPath = path.join(root, "eval.db");
  const live = new Database(dbPath);
  try {
    live.pragma("journal_mode = WAL");
    live.exec("create table t (id integer primary key, v text); insert into t (v) values ('x');");
    const filesBefore = fs.readdirSync(root).sort();
    assert.ok(filesBefore.includes("eval.db-wal"), "fixture must have a live wal");

    const r = await checkDatabase(dbPath);
    assert.equal(r.status, "ok");
    assert.match(r.detail, /in place/);
    assert.deepEqual(fs.readdirSync(root).sort(), filesBefore, "no new files may appear");
  } finally {
    live.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("database: garbage file fails instead of passing silently", async () => {
  const root = tmpdir("doctor-db-garbage-");
  try {
    const dbPath = path.join(root, "eval.db");
    fs.writeFileSync(dbPath, "this is not a sqlite database, not even close");
    const r = await checkDatabase(dbPath);
    assert.equal(r.status, "fail");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("port check is report-only and never fails the doctor", () => {
  const r = checkPort3000();
  assert.ok(["ok", "info", "skip"].includes(r.status), `unexpected status ${r.status}`);
});

test("disk headroom reports without failing", () => {
  const r = checkDiskHeadroom(os.tmpdir());
  assert.ok(["ok", "warn", "skip"].includes(r.status), `unexpected status ${r.status}`);
});

test("runDoctor: healthy fixture checkout exits 0", async () => {
  const root = tmpdir("doctor-run-healthy-");
  try {
    writeHealthyCheckout(root, CURRENT_MAJOR);
    const { results, exitCode } = await runDoctor({ repoRoot: root, dataRoot: root });
    assert.equal(exitCode, 0, JSON.stringify(results, null, 2));
    assert.equal(results.some((r) => r.status === "fail"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runDoctor: staled .next is flagged but stays exit 0 (warn, not fail)", async () => {
  const root = tmpdir("doctor-run-stale-");
  try {
    writeHealthyCheckout(root, CURRENT_MAJOR);
    fs.mkdirSync(path.join(root, ".next"));
    const marker = path.join(root, ".next", "build-manifest.json");
    fs.writeFileSync(marker, "{}");
    const old = new Date(Date.now() - 3_600_000);
    fs.utimesSync(marker, old, old);
    fs.writeFileSync(path.join(root, "package-lock.json"), "{}\n");

    const { results, exitCode } = await runDoctor({ repoRoot: root, dataRoot: root });
    const next = results.find((r) => r.id === "next-cache");
    assert.equal(next?.status, "warn");
    assert.match(next?.detail ?? "", /Stale \.next cache/);
    assert.equal(exitCode, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
