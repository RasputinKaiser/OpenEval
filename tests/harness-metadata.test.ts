import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BUILTIN_DESCRIPTORS } from "../lib/adapters/builtin";
import { validateDescriptor } from "../lib/adapters/schema";
import { buildDescriptorCommand, parseGenericJsonlLine, resolveDescriptorBinInfo } from "../lib/adapters/generic";
import { discoverModels, isValidModelId, resolveDefaultModel } from "../lib/models";
import { probeFlagObserved, runProbe } from "../lib/adapters/discover";

test("Codex declares the image flag exposed by its installed CLI", () => {
  const raw = BUILTIN_DESCRIPTORS.find((descriptor) => descriptor.id === "codex");
  assert.ok(raw);
  const { descriptor, issues } = validateDescriptor(raw, "test:codex");
  assert.deepEqual(issues, []);
  assert.equal(descriptor?.capabilities.supportsVisionInput, true);
  assert.deepEqual(descriptor?.helpArgs, ["exec", "--help"]);
  assert.equal(descriptor?.imageFlag, "-i");
  assert.deepEqual(descriptor?.capabilities.permissionModes, ["bypassPermissions", "default"]);
});

test("Hermes descriptor matches its query, image, and non-structured output CLI", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "harnesses/hermes.harness.json"), "utf8"));
  const { descriptor, issues } = validateDescriptor(raw, "test:hermes");
  assert.deepEqual(issues, []);
  assert.equal(descriptor?.parser, "text");
  assert.deepEqual(descriptor?.helpArgs, ["chat", "--help"]);
  assert.deepEqual(descriptor?.argTemplate, ["chat", "--query", "{prompt}", "--quiet", "--cli"]);
  assert.equal(descriptor?.capabilities.supportsVisionInput, true);
  assert.deepEqual(descriptor?.capabilities.permissionModes, []);
  assert.equal(descriptor?.capabilities.reportsCost, false);
  assert.equal(descriptor?.capabilities.reportsTokens, false);
  assert.equal(descriptor?.capabilities.reportsTurns, false);
  assert.equal(descriptor?.imageFlag, "--image");
  assert.equal(descriptor?.liveTrace?.format, "hermes-json");
  assert.deepEqual(descriptor?.liveTrace?.roots, ["~/.hermes/sessions"]);
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

test("unknown configured models do not claim visual-code output", () => {
  const models = discoverModels("ncode");
  assert.equal(models.find((model) => model.id === "opus")?.capabilities.visualCodeOutput, null);
});

test("descriptor defaults resolve consistently for runs and model APIs", () => {
  assert.deepEqual(resolveDefaultModel("ncode"), { id: "glm-5.2", source: "descriptor" });
});

test("binary resolution honors the execution environment override", () => {
  const envKey = `OPENEVAL_TEST_BIN_${process.pid}`;
  const { descriptor, issues } = validateDescriptor({
    id: "env-bin-test",
    label: "Environment binary test",
    binNames: ["definitely-not-on-path"],
    defaultBin: "definitely-not-on-path",
    binEnvVar: envKey,
    parser: "text",
    argTemplate: ["{prompt}"],
  }, "test:env-bin");
  assert.deepEqual(issues, []);
  const before = process.env[envKey];
  process.env[envKey] = process.execPath;
  try {
    assert.deepEqual(resolveDescriptorBinInfo(descriptor!), { bin: process.execPath, source: "env" });
  } finally {
    if (before == null) delete process.env[envKey]; else process.env[envKey] = before;
  }
});

test("image attachments become repeated descriptor flag pairs", () => {
  const raw = BUILTIN_DESCRIPTORS.find((descriptor) => descriptor.id === "codex")!;
  const { descriptor } = validateDescriptor(raw, "test:codex-image-command");
  const command = buildDescriptorCommand(descriptor!, {
    caseId: "image-case",
    workdir: "/tmp/workdir",
    prompt: "inspect the image",
    maxTurns: 5,
    timeoutMs: 1000,
    permissionMode: "default",
    model: "gpt-5.5",
    extraArgs: [],
    images: ["/tmp/workdir/a.png", "/tmp/workdir/b.png"],
  });
  assert.deepEqual(command.args, [
    "exec", "--json", "--skip-git-repo-check", "-s", "read-only", "-m", "gpt-5.5",
    "-i", "/tmp/workdir/a.png", "-i", "/tmp/workdir/b.png", "inspect the image",
  ]);
});

test("harness probing verifies version and help without running a model", async () => {
  const version = await runProbe(process.execPath, ["--version"]);
  const help = await runProbe(process.execPath, ["--help"]);
  assert.equal(version.ok, true);
  assert.equal(help.ok, true);
});

test("harness probing matches the descriptor flag, not a hardcoded image option", () => {
  assert.equal(probeFlagObserved("Usage: agent --attach FILE\n--other VALUE", "--attach"), true);
  assert.equal(probeFlagObserved("Usage: agent --attach FILE", "--image"), false);
  assert.equal(probeFlagObserved("  --attach=FILE", "--attach"), true);
  assert.equal(probeFlagObserved("  --image FILE", "-i"), false);
});

test("generic JSONL boolean fields preserve textual false values", () => {
  const acc: any = { startedAt: Date.now(), transcript: [], toolCalls: [], finalText: "", result: null };
  parseGenericJsonlLine('{"name":"shell","id":"c1"}', acc, { fields: { toolCallName: "name", toolCallId: "id" } });
  parseGenericJsonlLine('{"id":"c1","output":"ok","error":"false"}', acc, { fields: { toolCallOutput: "output", toolCallId: "id", toolCallError: "error" } });
  parseGenericJsonlLine('{"type":"done","error":"false"}', acc, { fields: { isError: "error" } });
  assert.equal(acc.toolCalls[0].isError, false);
  assert.equal(acc.result.isError, false);
  assert.equal(acc.result.exitCode, 0);
});

test("model id validation accepts custom ids but rejects blank and control-filled values", () => {
  assert.equal(isValidModelId("provider/model-v1"), true);
  assert.equal(isValidModelId("  provider/model-v1  "), true);
  assert.equal(isValidModelId("   "), false);
  assert.equal(isValidModelId("provider/model\n-v1"), false);
});
