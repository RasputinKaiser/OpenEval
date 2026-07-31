import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { boundedRunInt, sanitizeRunDefaults } from "../lib/run-defaults";

const ROOT = path.join(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("browser run defaults reject corrupt values instead of expanding the launch plan", () => {
  assert.deepEqual(sanitizeRunDefaults({
    defaultHarness: 42,
    defaultModel: "gpt\u0000bad",
    defaultParallel: 1.5,
    defaultSamples: 99,
  }), {
    defaultHarness: "",
    defaultModel: "",
    defaultParallel: 1,
    defaultSamples: 1,
  });
  assert.equal(boundedRunInt("4"), 4);
  assert.equal(boundedRunInt("0"), 1);
  assert.equal(boundedRunInt("2.5"), 1);
  assert.equal(sanitizeRunDefaults({ defaultSamples: "1e3" }).defaultSamples, 1);
});

test("New Run imports the small defaults module rather than the Settings page bundle", () => {
  const source = read("components/NewRunClient.tsx");
  assert.match(source, /@\/lib\/run-defaults/);
  assert.doesNotMatch(source, /SettingsClient/);
});

test("Harnesses surfaces registry truth and keeps refreshes out of client and HTTP caches", () => {
  const client = read("components/HarnessesClient.tsx");
  const route = read("app/api/harnesses/route.ts");
  assert.match(client, /descriptorIssues/);
  assert.match(client, /defaultHarness/);
  assert.match(client, /availableCount/);
  assert.match(client, /cache: "no-store"/);
  assert.match(client, /role="tabpanel"/);
  assert.match(client, /Collection contract/);
  assert.match(route, /query\.data\.refresh[\s\S]*"private, no-store"/);
});

test("Harness discovery exposes execution and transcript integration provenance", () => {
  const source = read("lib/adapters/discover.ts");
  assert.match(source, /export interface HarnessIntegration/);
  assert.match(source, /modelAliasCount/);
  assert.match(source, /liveTrace:/);
  assert.match(source, /sampleCommand,/);
});

test("Settings distinguishes persistence scopes and renders typed database diagnostics", () => {
  const source = read("components/SettingsClient.tsx");
  assert.match(source, /Global judge fallback/);
  assert.match(source, /Resolution order/);
  assert.match(source, /Storage health/);
  assert.match(source, /role="switch"/);
  assert.match(source, /Confirm reset/);
  assert.match(source, /maintenance\?\.db/);
  assert.doesNotMatch(source, /Object\.entries\(maintenance\)/);
});

test("System pages share a responsive local navigation", () => {
  const harnesses = read("components/HarnessesClient.tsx");
  const settings = read("components/SettingsClient.tsx");
  const nav = read("components/SystemNav.tsx");
  assert.match(harnesses, /<SystemNav \/>/);
  assert.match(settings, /<SystemNav \/>/);
  assert.match(nav, /aria-current/);
  assert.match(nav, /overflow-x-auto/);
});
