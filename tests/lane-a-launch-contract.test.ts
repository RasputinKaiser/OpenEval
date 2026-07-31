import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describeHarnessFailure, describeHarnessSelection } from "../lib/adapters/diagnostics";
import { sanitizeRunDefaults } from "../lib/run-defaults";
import type { DiscoveredHarness } from "../lib/adapters/discover";

const ROOT = path.join(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

function discovered(id: string, status: DiscoveredHarness["status"], detail?: string): DiscoveredHarness {
  return { id, status, detail } as DiscoveredHarness;
}

test("harness launch selection refuses an unavailable default and preserves probe diagnosis", () => {
  const state = describeHarnessSelection({
    defaultHarness: "codex",
    harnesses: [discovered("codex", "error", "probe timed out")],
  });
  assert.equal(state.effectiveId, "codex");
  assert.equal(state.diagnostic?.title, "CLI probe timed out");
  assert.match(state.diagnostic?.message ?? "", /before launching/i);
  assert.equal(describeHarnessFailure({ id: "ncode", status: "error", detail: "EACCES: permission denied" }).title, "CLI cannot execute");
});

test("stored run defaults trim harmless surrounding whitespace and reject controls", () => {
  assert.deepEqual(
    sanitizeRunDefaults({ defaultHarness: "  ncode  ", defaultModel: " gpt-5.6-luna ", defaultParallel: 3, defaultSamples: 2 }),
    { defaultHarness: "ncode", defaultModel: "gpt-5.6-luna", defaultParallel: 3, defaultSamples: 2 },
  );
  assert.equal(sanitizeRunDefaults({ defaultHarness: "ncode\n", defaultModel: "\t" }).defaultHarness, "");
  assert.equal(sanitizeRunDefaults({ defaultHarness: "\t" }).defaultModel, "");
});

test("New Run ignores stale URL ids in both preview and submitted selection", () => {
  const client = read("components/NewRunClient.tsx");
  assert.match(client, /const knownCaseIds = new Set\(cases\.map/);
  assert.match(client, /const selectedCount = cases\.filter\(\(c\) => selected\[c\.id\]\)\.length/);
  assert.match(client, /const hasExplicitSelection = initialCaseIds\.length > 0 \|\| selectedCount > 0/);
  assert.match(client, /const plannedCases = cases\.filter/);
  assert.match(client, /v && knownCaseIds\.has\(id\)/);
  assert.match(client, /Checking harness availability before launch/);
});

test("New Run scopes model discovery to the resolved default harness", () => {
  const client = read("components/NewRunClient.tsx");
  assert.match(client, /const effectiveHarness = harness \|\| harnessInfo\?\.defaultHarness/);
  assert.match(client, /ModelPicker[\s\S]*harness=\{effectiveHarness\}/);
  assert.match(client, /Evidence:/);
  assert.match(client, /max turns/);
});

test("run-start errors keep selection failures at 400 and unexpected failures at 500", () => {
  const route = read("app/api/runs/route.ts");
  assert.match(route, /return startRunErrorResponse\(error\)/);
  assert.match(route, /if \(\/no cases match\/i\.test\(message\)\) return badRequest/);
  assert.match(route, /return internalError\("Failed to start run", error\)/);
});

test("direct API launches preflight registered harness availability", () => {
  const route = read("app/api/runs/route.ts");
  assert.match(route, /const discovered = await probeHarness\(harness\)/);
  assert.match(route, /Harness .* is unavailable/);
});

test("picker failure paths are visible and stale discovery responses cannot win", () => {
  const harness = read("components/HarnessPicker.tsx");
  const model = read("components/ModelPicker.tsx");
  assert.match(harness, /const request = \+\+requestId\.current/);
  assert.match(harness, /Harness discovery failed/);
  assert.match(harness, /onDiscovered\?\.\(\{ harnesses: \[\], defaultHarness: "" \}\)/);
  assert.match(model, /Model discovery failed/);
  assert.match(model, /Retry model discovery/);
  assert.match(model, /invalidateCache\(urlForModels\(harness\)\)/);
});

function runCli(args: string[]) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-lane-a-cli-"));
  try {
    return spawnSync(process.execPath, ["--import", "tsx", path.join(ROOT, "lib/cli/run.ts"), ...args], {
      cwd: ROOT,
      env: { ...process.env, OPENEVAL_DATA_ROOT: dataRoot },
      encoding: "utf8",
      timeout: 30_000,
    });
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
}

test("CLI rejects ambiguous launch values with machine-readable errors", () => {
  for (const args of [["--parallel", "2.5", "--json"], ["--samples", "9", "--json"], ["--runner", "bogus", "--json"], ["--not-a-flag", "--json"]]) {
    const result = runCli(args);
    assert.notEqual(result.status, 0, args.join(" "));
    const payload = JSON.parse(result.stdout.trim()) as { ok: boolean; error: string };
    assert.equal(payload.ok, false);
    assert.match(payload.error, /integer between 1 and 8|runner must be|Unknown option/);
  }
});

test("CLI JSON harness listing has no human probe preamble and no-watch copy is truthful", () => {
  const cli = read("lib/cli/run.ts");
  assert.match(cli, /listHarnesses\(outputJson\)/);
  assert.match(cli, /JSON\.stringify\(\{ harnesses/);
  assert.match(cli, /Suppress live progress while waiting for terminal status/);
  assert.doesNotMatch(cli, /--no-watch\s+Exit immediately after starting/);
});

test("CLI does not report missing or aborted runs as successful", () => {
  const cli = read("lib/cli/run.ts");
  assert.match(cli, /Run \$\{id\} disappeared before reaching a terminal status/);
  assert.match(cli, /if \(status === null \|\| status === 'aborted'\) return 2/);
});
