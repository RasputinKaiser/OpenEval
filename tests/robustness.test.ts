import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, open, writeFile, appendFile, rm } from "node:fs/promises";
import { resolveWithin } from "../lib/config";
import { safeParse } from "../lib/db";
import { makeTailReader } from "../lib/runner/tmux";

// ---- resolveWithin (artifact path safety) ----

test("resolveWithin allows plain and nested subpaths", () => {
  const base = "/srv/workdir";
  assert.equal(resolveWithin(base, "file.txt"), path.join(base, "file.txt"));
  assert.equal(resolveWithin(base, "dist/index.html"), path.join(base, "dist/index.html"));
  assert.equal(resolveWithin(base, "./a/b/c.css"), path.join(base, "a/b/c.css"));
});

test("resolveWithin blocks traversal and absolute escapes", () => {
  const base = "/srv/workdir";
  assert.equal(resolveWithin(base, "../secret.txt"), null);
  assert.equal(resolveWithin(base, "a/../../secret.txt"), null);
  assert.equal(resolveWithin(base, "/etc/passwd"), null);
  // the base itself is not a servable artifact
  assert.equal(resolveWithin(base, "."), null);
});

test("resolveWithin is not fooled by a sibling dir sharing a name prefix", () => {
  // A naive `startsWith(base)` check would accept `/srv/workdir-evil/...`.
  assert.equal(resolveWithin("/srv/workdir", "../workdir-evil/x"), null);
});

// ---- safeParse (DB read resilience) ----

test("safeParse returns parsed value for valid JSON", () => {
  assert.deepEqual(safeParse('{"a":1}', {}), { a: 1 });
  assert.deepEqual(safeParse("[1,2,3]", []), [1, 2, 3]);
});

test("safeParse falls back on null, undefined, and corrupt JSON", () => {
  const fallback = { runner: "headless", parallel: 1 };
  assert.equal(safeParse(null, fallback), fallback);
  assert.equal(safeParse(undefined, fallback), fallback);
  assert.equal(safeParse("{truncated", fallback), fallback);
  assert.equal(safeParse("", fallback), fallback);
});

// ---- makeTailReader (tmux log tail retention + incremental reads) ----

test("makeTailReader retains the completion event past the 8 MB front-truncation limit", async () => {
  // Regression for the tmux `output.slice(0, 8MB)` bug: the terminal `result`
  // event lives at the END of a long session, so anything beyond 8 MB was
  // dropped and the run always fell to a timeout/fail.
  const dir = await mkdtemp(path.join(os.tmpdir(), "openeval-tail-"));
  const file = path.join(dir, "log.jsonl");
  const filler = "x".repeat(1024) + "\n"; // 1 KiB per line
  const lines = 9 * 1024; // ~9 MiB of filler, past the old 8 MiB cap
  const completion = '{"type":"result","result":"done past 8mb"}';
  try {
    await writeFile(file, "", "utf8");
    // Small per-read chunk so drain() must loop across the cap boundary.
    const handle = await open(file, "r");
    try {
      const reader = makeTailReader(handle, 64 * 1024);
      await appendFile(file, filler.repeat(lines) + completion + "\n", "utf8");
      const all = await reader.drain();
      const parsed = all.trimEnd().split("\n");
      assert.equal(parsed[parsed.length - 1], completion, "completion event beyond 8 MB must survive");
      assert.ok(reader.offset > 8 * 1024 * 1024, "reader advanced past the old 8 MB truncation point");
    } finally {
      await handle.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("makeTailReader reads only appended bytes across successive ticks", async () => {
  // Regression for the O(n²) poll: each tick must read only the newly appended
  // tail, never re-decode the whole growing file.
  const dir = await mkdtemp(path.join(os.tmpdir(), "openeval-tail-"));
  const file = path.join(dir, "log.jsonl");
  try {
    await writeFile(file, "first\n", "utf8");
    const handle = await open(file, "r");
    try {
      const reader = makeTailReader(handle);
      assert.equal(await reader.read(), "first\n");
      assert.equal(await reader.read(), "", "no new bytes yet");
      await appendFile(file, "second\n", "utf8");
      assert.equal(await reader.read(), "second\n", "only the appended delta, not the whole file");
      assert.equal(reader.offset, "first\nsecond\n".length);
    } finally {
      await handle.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("makeTailReader preserves a multi-byte UTF-8 char split across a read boundary", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "openeval-tail-"));
  const file = path.join(dir, "log.jsonl");
  try {
    // "😀" is 4 UTF-8 bytes; a 2-byte chunk forces the split.
    await writeFile(file, "😀\n", "utf8");
    const handle = await open(file, "r");
    try {
      const reader = makeTailReader(handle, 2);
      let out = "";
      out += await reader.read();
      out += await reader.drain();
      assert.equal(out, "😀\n", "surrogate must not be corrupted by the byte-boundary split");
    } finally {
      await handle.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
