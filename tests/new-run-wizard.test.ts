import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildRunSentence, inferErrorField, isRunField, parseBoundedInt } from "../components/newRunValidation";

// lib/config captures ROOT from process.cwd() at import time, so every
// cwd-rooted path must be redirected into a temp dir BEFORE any route module
// is imported. Route imports below are dynamic for that reason.
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-u11-wizard-"));
process.chdir(tempRoot);

after(() => {
  process.chdir(os.tmpdir());
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function postRuns(body: unknown): Request {
  return new Request("http://localhost:3000/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Pure wizard validation helpers (mirror the API rules) ──

test("parseBoundedInt accepts in-range integers", () => {
  assert.deepEqual(parseBoundedInt("1"), { value: 1, error: null });
  assert.deepEqual(parseBoundedInt("8"), { value: 8, error: null });
  assert.deepEqual(parseBoundedInt(" 4 "), { value: 4, error: null });
});

test("parseBoundedInt rejects empty, non-integer, and out-of-range input with a message", () => {
  for (const raw of ["", "  ", "abc", "2.5", "1e3", "0", "9", "-1", "9999"]) {
    const parsed = parseBoundedInt(raw);
    assert.equal(parsed.value, null, `"${raw}" must not parse`);
    assert.ok(parsed.error && /between 1 and 8/.test(parsed.error), `"${raw}" carries a bounded-range message`);
  }
});

test("inferErrorField maps API messages to wizard fields", () => {
  assert.equal(inferErrorField("caseIds must include at least one case id"), "caseIds");
  assert.equal(inferErrorField("No cases match the filter"), "caseIds");
  assert.equal(inferErrorField('Unknown harness "bogus". Registered harnesses: ncode'), "harness");
  assert.equal(inferErrorField("model not supported"), "model");
  assert.equal(inferErrorField("parallel out of range"), "parallel");
  assert.equal(inferErrorField("samples out of range"), "samples");
  assert.equal(inferErrorField("something exploded"), null);
});

test("isRunField accepts only known fields", () => {
  assert.equal(isRunField("harness"), true);
  assert.equal(isRunField("caseIds"), true);
  assert.equal(isRunField("bogus"), false);
  assert.equal(isRunField(42), false);
  assert.equal(isRunField(undefined), false);
});

test("buildRunSentence pluralizes and tolerates unparsed fields", () => {
  assert.equal(
    buildRunSentence({ caseCount: 12, samples: 2, parallel: 4, harnessLabel: "claude-code", modelLabel: "opus" }),
    "12 cases × 2 samples on claude-code / opus, parallelism 4"
  );
  assert.equal(
    buildRunSentence({ caseCount: 1, samples: 1, parallel: 1, harnessLabel: "default (ncode)", modelLabel: "default model" }),
    "1 case × 1 sample on default (ncode) / default model, parallelism 1"
  );
  assert.equal(
    buildRunSentence({ caseCount: 0, samples: null, parallel: null, harnessLabel: "x", modelLabel: "y" }),
    "0 cases × ? samples on x / y, parallelism ?"
  );
});

// ── POST /api/runs backstop validation (field-tagged 400s) ──

test("POST /api/runs: unknown harness → 400 tagged field=harness, no run created", async () => {
  const runsRoute = await import("../app/api/runs/route");
  const db = await import("../lib/db");
  const before = db.countRuns();
  const res = await runsRoute.POST(postRuns({ harness: "definitely-not-a-harness", caseIds: ["whatever"] }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /Unknown harness "definitely-not-a-harness"/);
  assert.match(body.error, /Registered harnesses:/);
  assert.equal(body.field, "harness");
  assert.equal(db.countRuns(), before);
});

test("POST /api/runs: explicit-but-empty caseIds → 400 tagged field=caseIds", async () => {
  const runsRoute = await import("../app/api/runs/route");
  const res = await runsRoute.POST(postRuns({ caseIds: [] }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /caseIds/);
  assert.equal(body.field, "caseIds");
});

test("POST /api/runs: registered harness passes the gate; case selection failure is tagged field=caseIds", async () => {
  const runsRoute = await import("../app/api/runs/route");
  const registry = await import("../lib/adapters/registry");
  const known = registry.listAdapters()[0]?.id;
  assert.ok(known, "at least one built-in harness is registered");
  const db = await import("../lib/db");
  const before = db.countRuns();
  // Temp cwd has no cases/ dir, so selection fails after harness validation passes.
  const res = await runsRoute.POST(postRuns({ harness: known, caseIds: ["does-not-exist"] }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /No cases match/);
  assert.equal(body.field, "caseIds");
  assert.equal(db.countRuns(), before);
});
