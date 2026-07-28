import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  countDetectedFiles,
  discoverKnownSources,
  type DiscoveryTruncationReason,
} from "../lib/collection/discover";
import type { CollectionSourceDef } from "../lib/collection/sources";

function write(file: string, content = "{}"): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

test("exact-name detection excludes unrelated JSON and counts nested logs.json", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-discovery-accuracy-"));
  write(path.join(root, "settings.json"));
  write(path.join(root, "project-a", "logs.json"));
  write(path.join(root, "project-a", "other.json"));

  const detected = countDetectedFiles(root, { names: ["logs.json"] });
  assert.equal(detected.count, 1);
  assert.equal(detected.sample, path.join(root, "project-a", "logs.json"));
  assert.equal(detected.truncationReasons.length, 0);

  const gemini: CollectionSourceDef = {
    id: "gemini-test",
    label: "Gemini test",
    roots: [root],
    format: "jsonl-dir",
    parseable: false,
    detectNames: ["logs.json"],
  };
  const [source] = discoverKnownSources([gemini]);
  assert.equal(source.sessionCount, 1);
  assert.equal(source.status, "present");
  assert.equal(source.scanTruncated, undefined);
});

test("suffix detection remains supported alongside exact basenames", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-discovery-suffix-"));
  write(path.join(root, "session.jsonl"));
  write(path.join(root, "notes.txt"));

  const detected = countDetectedFiles(root, { exts: [".jsonl"] });
  assert.equal(detected.count, 1);
  assert.equal(path.basename(detected.sample ?? ""), "session.jsonl");
});

test("bounded detection reports max-depth and cap truncation reasons", () => {
  const depthRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-discovery-depth-"));
  write(path.join(depthRoot, "a", "b", "logs.json"));
  const depthLimited = countDetectedFiles(depthRoot, { names: ["logs.json"], maxDepth: 1 });
  assert.equal(depthLimited.count, 0);
  assert.deepEqual(depthLimited.truncationReasons, ["max-depth"] satisfies DiscoveryTruncationReason[]);

  const unrelatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-discovery-unrelated-depth-"));
  write(path.join(unrelatedRoot, "unrelated", "deep", "metadata.json"));
  const unrelatedDepth = countDetectedFiles(unrelatedRoot, { names: ["logs.json"], maxDepth: 1 });
  assert.equal(unrelatedDepth.count, 0);
  assert.deepEqual(unrelatedDepth.truncationReasons, []);

  // The evidence probe is bounded too. A matching subtree after more than
  // 2048 unrelated entries must stay conservatively marked as incomplete.
  const probeBudgetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-discovery-probe-budget-"));
  for (let i = 0; i < 2_049; i++) {
    write(path.join(probeBudgetRoot, `a${String(i).padStart(4, "0")}`, "metadata.json"));
  }
  write(path.join(probeBudgetRoot, "z-target", "logs.json"));
  const probeBudget = countDetectedFiles(probeBudgetRoot, { names: ["logs.json"], maxDepth: 0 });
  assert.equal(probeBudget.count, 0);
  assert.deepEqual(probeBudget.truncationReasons, ["max-depth"] satisfies DiscoveryTruncationReason[]);

  const capRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-discovery-cap-"));
  write(path.join(capRoot, "a.json"));
  write(path.join(capRoot, "b.json"));
  write(path.join(capRoot, "c.json"));
  const capLimited = countDetectedFiles(capRoot, { exts: [".json"], cap: 2 });
  assert.equal(capLimited.count, 2);
  assert.deepEqual(capLimited.truncationReasons, ["cap"] satisfies DiscoveryTruncationReason[]);

  const source: CollectionSourceDef = {
    id: "bounded-test",
    label: "Bounded test",
    roots: [capRoot],
    format: "jsonl-dir",
    parseable: false,
    detectExts: [".json"],
  };
  const [discovered] = discoverKnownSources([source], { cap: 2 });
  assert.equal(discovered.sessionCount, 2);
  assert.equal(discovered.scanTruncated, true);
  assert.deepEqual(discovered.scanTruncationReasons, ["cap"] satisfies DiscoveryTruncationReason[]);
});
