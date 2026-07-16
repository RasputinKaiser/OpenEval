import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BUILTIN_DESCRIPTORS } from "../lib/adapters/builtin";
import { validateDescriptor } from "../lib/adapters/schema";
import { discoverModels } from "../lib/models";

test("Codex declares the image flag exposed by its installed CLI", () => {
  const raw = BUILTIN_DESCRIPTORS.find((descriptor) => descriptor.id === "codex");
  assert.ok(raw);
  const { descriptor, issues } = validateDescriptor(raw, "test:codex");
  assert.deepEqual(issues, []);
  assert.equal(descriptor?.capabilities.supportsVisionInput, true);
  assert.deepEqual(descriptor?.capabilities.permissionModes, ["bypassPermissions", "default"]);
});

test("Hermes descriptor matches its query, image, and non-structured output CLI", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "harnesses/hermes.harness.json"), "utf8"));
  const { descriptor, issues } = validateDescriptor(raw, "test:hermes");
  assert.deepEqual(issues, []);
  assert.equal(descriptor?.parser, "text");
  assert.deepEqual(descriptor?.argTemplate, ["chat", "--query", "{prompt}", "--quiet", "--cli"]);
  assert.equal(descriptor?.capabilities.supportsVisionInput, true);
  assert.deepEqual(descriptor?.capabilities.permissionModes, []);
  assert.equal(descriptor?.capabilities.reportsCost, false);
  assert.equal(descriptor?.capabilities.reportsTokens, false);
  assert.equal(descriptor?.capabilities.reportsTurns, false);
});

test("an omitted vision declaration stays unknown instead of becoming a false claim", () => {
  const { descriptor, issues } = validateDescriptor({
    id: "unknown-vision",
    label: "Unknown vision harness",
    binNames: ["unknown-vision"],
    parser: "text",
    argTemplate: ["{prompt}"],
  }, "test:unknown-vision");
  assert.deepEqual(issues, []);
  assert.equal(descriptor?.capabilities.supportsVisionInput, null);
});

test("an unknown harness does not receive another harness's model catalog", () => {
  assert.deepEqual(discoverModels("does-not-exist"), []);
});

test("Claude model aliases inherit the harness's proven image-input capability", () => {
  const models = discoverModels("claude-code");
  assert.equal(models.find((model) => model.id === "opus")?.capabilities.visionInput, true);
  assert.equal(models.find((model) => model.id === "sonnet")?.capabilities.visionInput, true);
});
