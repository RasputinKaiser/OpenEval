import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("new benchmark launch is organized around bounded recipe presets", () => {
  const client = read("components/NewRunClient.tsx");

  assert.match(client, /Build a benchmark recipe/);
  assert.match(client, /Core suite/);
  assert.match(client, /Creative sampler/);
  assert.match(client, /visual-isometric-voxel-world/);
  assert.match(client, /Creative lab/);
  assert.match(client, /data-testid=\{`run-preset-\$\{preset\.id\}`\}/);
  assert.match(client, /Case budget ceiling/);
  assert.match(client, /not provider billing/);
  assert.match(client, /initialCaseIds\.length > 0 \? cases\.map/);
});

test("visual benchmark lane is discoverable from the launch catalog", () => {
  const client = read("components/NewRunClient.tsx");
  const cases = fs.readdirSync(path.join(ROOT, "cases/visual-code"));

  assert.ok(cases.includes("visual-pixel-art-scene.case.json"));
  assert.ok(cases.includes("visual-3d-depth-lab.case.json"));
  assert.ok(cases.includes("visual-isometric-voxel-world.case.json"));
  assert.ok(cases.includes("visual-markdown-runbook.case.json"));
  assert.match(client, /visual-code/);
  assert.match(client, /selectedVisualCount/);
  assert.match(client, /Output:/);
  assert.match(client, /Deliverable:/);
  assert.match(client, /Text \/ Markdown/);
});
