import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectSourceFiles, scanSourceSessions } from "../lib/live";
import { _setCollectionHooksForTest, scanAllSources } from "../lib/collection/aggregate";
import { defToSpec, type CollectionSourceDef } from "../lib/collection/sources";
import type { DiscoveredSource } from "../lib/collection/discover";

const cleanupDirs: string[] = [];
after(() => {
  _setCollectionHooksForTest(null);
  for (const dir of cleanupDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function fixtureDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

function writeJsonl(dir: string, name: string, records: Array<unknown>, malformed = false): string {
  const file = path.join(dir, name);
  const lines = records.map((record) => JSON.stringify(record));
  if (malformed) lines.splice(1, 0, "{not-json");
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  return file;
}

function source(id: string, label: string, root: string, inferredModel?: string): CollectionSourceDef {
  return { id, label, roots: [root], format: "jsonl-dir", parseable: true, inferredModel };
}

test("Collection carries LiveAggregate provenance and separates file inventory classes", () => {
  const measuredDir = fixtureDir("openeval-fidelity-measured-");
  const inferredDir = fixtureDir("openeval-fidelity-inferred-");
  const missingDir = fixtureDir("openeval-fidelity-missing-");
  const detectDir = fixtureDir("openeval-fidelity-detect-");

  writeJsonl(measuredDir, "measured.jsonl", [
    { type: "system", sessionId: "measured", cwd: "/tmp/fidelity", model: "gpt-4.1", timestamp: "2026-07-20T10:00:00.000Z" },
    { type: "user", message: { role: "user", content: "measure this" }, timestamp: "2026-07-20T10:00:01.000Z" },
    { type: "assistant", message: { model: "gpt-4.1", content: [{ type: "text", text: "done" }] }, timestamp: "2026-07-20T10:00:02.000Z" },
    { type: "result", usage: { input_tokens: 20, output_tokens: 10 }, total_cost_usd: 0.01, duration_ms: 2_000, timestamp: "2026-07-20T10:00:03.000Z" },
  ]);
  writeJsonl(inferredDir, "inferred.jsonl", [
    { type: "system", sessionId: "inferred", cwd: "/tmp/fidelity", timestamp: "2026-07-20T11:00:00.000Z" },
    { type: "user", message: { role: "user", content: "infer this" }, timestamp: "2026-07-20T11:00:01.000Z" },
    { type: "assistant", message: { content: [{ type: "text", text: "done" }], usage: { input_tokens: 30, output_tokens: 5 } }, timestamp: "2026-07-20T11:00:02.000Z" },
  ], true);
  writeJsonl(missingDir, "missing.jsonl", [
    { type: "system", sessionId: "missing", cwd: "/tmp/fidelity", timestamp: "2026-07-20T12:00:00.000Z" },
    { type: "user", message: { role: "user", content: "no metrics" }, timestamp: "2026-07-20T12:00:01.000Z" },
    { type: "assistant", message: { content: [{ type: "text", text: "done" }] }, timestamp: "2026-07-20T12:00:02.000Z" },
  ]);

  const defs = [
    source("measured", "Measured", measuredDir),
    source("inferred", "Inferred", inferredDir, "gpt-4.1"),
    source("missing", "Missing", missingDir),
    { id: "detect", label: "Detect only", roots: [detectDir], format: "jsonl-dir" as const, parseable: false, detectExts: [".json"] },
  ];
  fs.writeFileSync(path.join(detectDir, "one.json"), "{}", "utf8");
  fs.writeFileSync(path.join(detectDir, "two.json"), "{}", "utf8");

  const discovered: DiscoveredSource[] = defs.map((def) => {
    if (!def.parseable) {
      return {
        id: def.id, label: def.label, format: def.format, parseable: false, roots: def.roots,
        presentRoots: def.roots, sessionCount: 2, lastActivityMs: null, status: "present", note: "not parsed",
        scanTruncated: true, scanTruncationReasons: ["max-depth"],
      };
    }
    const collected = collectSourceFiles(defToSpec(def));
    return {
      id: def.id, label: def.label, format: def.format, parseable: true, roots: def.roots,
      presentRoots: def.roots, sessionCount: collected.files.length,
      lastActivityMs: collected.files[0]?.mtime ?? null,
      status: collected.files.length > 0 ? "present" : "empty", collected,
    };
  });

  _setCollectionHooksForTest({
    discover: () => discovered,
    sources: () => defs,
    unknown: () => [],
    fingerprintTtlMs: 0,
    unknownTtlMs: 0,
  });
  const result = scanAllSources(20, { fresh: true });

  assert.equal(result.totalParseableFiles, 3);
  assert.equal(result.totalDetectOnlyFiles, 2);
  assert.equal(result.totalFiles, 5);
  assert.equal(result.inventoryPartial, true);
  assert.deepEqual(result.inventoryPartialSources, ["detect"]);
  assert.equal(result.totalParsedSessions, 3);
  assert.equal(result.totalMeasuredUsageSessions, 2);
  assert.equal(result.totalMeasuredDurationSessions, 1);
  assert.equal(result.totalMissingModelSessions, 1);
  assert.equal(result.totalInferredModelSessions, 1);
  assert.equal(result.totalMissingTokenSessions, 1);
  assert.equal(result.totalInferredCostSessions, 1);
  assert.equal(result.totalMalformedLineSessions, 1);

  const measured = result.sources.find((s) => s.id === "measured");
  const inferred = result.sources.find((s) => s.id === "inferred");
  const missing = result.sources.find((s) => s.id === "missing");
  const detect = result.sources.find((s) => s.id === "detect");
  assert.equal(measured?.sessionsWithMeasuredUsage, 1);
  assert.equal(measured?.sessionsWithMeasuredDuration, 1);
  assert.equal(inferred?.sessionsWithInferredModel, 1);
  assert.equal(inferred?.sessionsWithInferredCost, 1);
  assert.equal(inferred?.sessionsWithMalformedLines, 1);
  assert.equal(missing?.sessionsWithMissingModel, 1);
  assert.equal(missing?.sessionsWithMissingTokens, 1);
  assert.equal(detect?.parseable, false);
  assert.equal(detect?.parsedSessions, 0);
  assert.equal(detect?.inventoryTruncated, true);
  assert.deepEqual(detect?.inventoryTruncationReasons, ["max-depth"]);
  assert.match(detect?.scanWarnings[0] ?? "", /lower bound/);
});

test("Collection marks a hard parser scan cap partial even without a budget truncation", () => {
  const dir = fixtureDir("openeval-fidelity-hard-cap-");
  for (let i = 0; i < 3; i++) {
    writeJsonl(dir, `session-${i}.jsonl`, [
      { type: "system", sessionId: `hard-cap-${i}`, cwd: "/tmp/fidelity", model: "gpt-4.1", timestamp: `2026-07-21T10:0${i}:00.000Z` },
      { type: "user", message: { role: "user", content: "hard cap" }, timestamp: `2026-07-21T10:0${i}:01.000Z` },
      { type: "assistant", message: { model: "gpt-4.1", content: [{ type: "text", text: "done" }] }, timestamp: `2026-07-21T10:0${i}:02.000Z` },
    ]);
  }
  const def = source("hard-cap", "Hard cap", dir);
  const collected = collectSourceFiles(defToSpec(def));
  const discovered: DiscoveredSource[] = [{
    id: def.id, label: def.label, format: def.format, parseable: true, roots: def.roots,
    presentRoots: def.roots, sessionCount: collected.files.length, lastActivityMs: collected.files[0]?.mtime ?? null,
    status: "present", collected,
  }];

  _setCollectionHooksForTest({
    discover: () => discovered,
    sources: () => [def],
    unknown: () => [],
    // The production aggregate asks for the full-history limit. Force the
    // parser's own hard cap to one fixture file without setting budgetMs.
    scan: (spec, _limit, opts) => scanSourceSessions(spec, 1, opts),
    fingerprintTtlMs: 0,
    unknownTtlMs: 0,
  });
  const result = scanAllSources(20, { fresh: true });
  const hardCap = result.sources.find((s) => s.id === "hard-cap");

  assert.equal(result.partial, true);
  assert.deepEqual(result.partialSources, ["hard-cap"]);
  assert.equal(hardCap?.scanTruncated, true);
  assert.match(hardCap?.scanWarnings.find((warning) => warning.includes("scan cap reached")) ?? "", /scan cap reached/);
  assert.equal(result.totalParsedSessions, 1);
});
