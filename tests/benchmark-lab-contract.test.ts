import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("benchmark charts expose explicit measures, units, ticks, and accessible chart names", () => {
  const client = read("components/BenchClient.tsx");

  assert.match(client, /Tokens vs estimated cost/);
  assert.match(client, /Output throughput per case/);
  assert.match(client, /Total tokens \(input \+ output\)/);
  assert.match(client, /Estimated cost \(USD\)/);
  assert.match(client, /Output generation rate \(tokens per second\)/);
  assert.match(client, /niceTicks/);
  assert.match(client, /aria-labelledby="tokens-cost-chart-title tokens-cost-chart-desc"/);
  assert.match(client, /data-testid="benchmark-scatter-chart"/);
  assert.match(client, /data-testid="benchmark-throughput-chart"/);
});

test("benchmark breakdown keeps power-user detail while naming evidence plainly", () => {
  const client = read("components/BenchClient.tsx");

  assert.match(client, /Per-case performance/);
  assert.match(client, /Output tok\/s/);
  assert.match(client, /Input tok\/s/);
  assert.match(client, /Est\. cost \(USD\)/);
  assert.match(client, /Wall time/);
  assert.match(client, /Avg tool time/);
  assert.match(client, /wall clock/);
  assert.match(client, /CLI usage/);
  assert.match(client, /stream events/);
});

test("benchmark telemetry surfaces visual lanes without claiming visual quality", () => {
  const client = read("components/BenchClient.tsx");
  const route = read("app/api/runs/[id]/telemetry/route.ts");

  assert.match(route, /visualKind/);
  assert.match(route, /visualArtifacts/);
  assert.match(client, /Visual benchmark lanes/);
  assert.match(client, /Compare visual outputs/);
  assert.match(client, /visual quality still requires an explicit visual grader or human review/);
});
