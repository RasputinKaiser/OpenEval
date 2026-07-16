import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { CASES_DIR, FIXTURES_DIR } from "../lib/config";
import { loadCases, selectCases } from "../lib/cases";
import { prepareWorkdir } from "../lib/executor";
import { buildDescriptorCommand, makeGenericAdapter, parseGenericJsonlLine } from "../lib/adapters/generic";
import { validateDescriptor } from "../lib/adapters/schema";
import { BUILTIN_DESCRIPTORS } from "../lib/adapters/builtin";
import { collectRunManifest } from "../lib/manifest";
import { TmuxRunner } from "../lib/runner/tmux";
import type { ParseAccumulator } from "../lib/adapters/types";
import type { RunnerContext } from "../lib/types";
import { artifactKind } from "../components/ArtifactPreview";

function accumulator(): ParseAccumulator {
  return { startedAt: Date.now(), transcript: [], toolCalls: [], finalText: "", result: null };
}

test("case filters preserve deterministic selection and metadata", async () => {
  const all = await loadCases({ force: true });
  const swe = await selectCases({ categories: ["agentic-swe"], tags: ["bugfix"], difficulty: ["easy", "medium", "hard"] });
  assert.ok(swe.length >= 2);
  assert.ok(swe.every((c) => c.category === "agentic-swe" && c.tags?.includes("bugfix")));
  assert.deepEqual(swe.map((c) => c.id), [...swe].sort((a, b) => a.id.localeCompare(b.id)).map((c) => c.id));
  const canary = all.find((c) => c.id === "swe-log-summary-adversarial");
  assert.equal(canary?.split, "public");
  assert.equal(canary?.canary, "CANARY-7Q2F-messy-logs-001");
});

test("case loader invalidates its cache after a case mtime change", async () => {
  const file = path.join(CASES_DIR, "agentic-swe", "swe-fix-fizzbuzz.case.json");
  const before = await fs.stat(file);
  const beforeCases = await loadCases({ force: true });
  await fs.utimes(file, before.atime, new Date(before.mtimeMs + 2000));
  try {
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const after = await loadCases();
    assert.equal(after.length, beforeCases.length);
    assert.equal(after.find((c) => c.id === "swe-fix-fizzbuzz")?.name, "Fix the FizzBuzz bug");
  } finally {
    await fs.utimes(file, before.atime, before.mtime);
    await loadCases({ force: true });
  }
});

test("workdir preparation isolates none, fixture, and local git-clone setup", async () => {
  const runId = `pending-${process.pid}`;
  const none = await prepareWorkdir(runId, "none", { id: "none", name: "none", category: "single-tool", prompt: "", setup: { type: "none" }, graders: [] } as never, 0);
  assert.deepEqual(await fs.readdir(none.dir), []);

  const fixture = await prepareWorkdir(runId, "fixture", { id: "fixture", name: "fixture", category: "agentic-swe", prompt: "", setup: { type: "fixture", fixture: "fizzbuzz-repo", init_git: true }, graders: [] } as never, 0);
  assert.ok((await fs.stat(path.join(fixture.dir, "src", "fizzbuzz.js"))).isFile());
  assert.equal(fixture.fixtureSrc, path.join(FIXTURES_DIR, "fizzbuzz-repo"));
  assert.match(execFileSync("git", ["log", "-1", "--format=%s"], { cwd: fixture.dir, encoding: "utf8" }), /baseline/);

  const source = await fs.mkdtemp(path.join(os.tmpdir(), "openeval-clone-source-"));
  try {
    await fs.writeFile(path.join(source, "README.md"), "local clone\n");
    execFileSync("git", ["init", "-q"], { cwd: source });
    execFileSync("git", ["add", "README.md"], { cwd: source });
    execFileSync("git", ["-c", "user.email=eval@local", "-c", "user.name=eval", "commit", "-q", "-m", "source"], { cwd: source });
    const clone = await prepareWorkdir(runId, "clone", { id: "clone", name: "clone", category: "single-tool", prompt: "", setup: { type: "git-clone", repo: source }, graders: [] } as never, 0);
    assert.equal(await fs.readFile(path.join(clone.dir, "README.md"), "utf8"), "local clone\n");
    assert.match(execFileSync("git", ["log", "-1", "--format=%s"], { cwd: clone.dir, encoding: "utf8" }), /source/);
  } finally {
    await fs.rm(source, { recursive: true, force: true });
  }
});

test("descriptor command assembly covers modes, permissions, context, and extra environment", () => {
  const raw = {
    id: "pending-command",
    label: "Pending command",
    binNames: ["pending-command"] as string[],
    parser: "generic-jsonl",
    fields: { finalText: "answer", durationMs: "duration", inputTokens: "usage.in", outputTokens: "usage.out", toolCallName: "tool.name", toolCallInput: "tool.input", toolCallOutput: "tool.output", toolCallError: "tool.error" },
    argTemplate: ["run", "{workdir}", "{model}", "{maxTurns}"],
    prompt: { mode: "flag", flag: "--prompt" },
    permissionArgs: { default: ["--safe"], "*": ["--fallback", "{permissionMode}"] },
    extraEnv: { OPENEVAL_PENDING: "1" },
    workdirFlag: "--cwd",
    modelFlag: "--model",
    maxTurnsFlag: "--turns",
    appendExtraArgs: true,
  } as Record<string, unknown>;
  const { descriptor, issues } = validateDescriptor(raw, "pending-command");
  assert.deepEqual(issues, []);
  const context = { caseId: "case", workdir: "/tmp/work", prompt: "prompt {workdir}", maxTurns: 7, timeoutMs: 1000, permissionMode: "default", model: "model-x", extraArgs: ["--extra"] } satisfies RunnerContext;
  const command = buildDescriptorCommand(descriptor!, context);
  assert.deepEqual(command.args, ["run", "/tmp/work", "model-x", "7", "--safe", "--extra", "--prompt", "prompt {workdir}"]);
  assert.deepEqual(command.env, { OPENEVAL_PENDING: "1" });

  const wildcard = validateDescriptor({ ...raw, permissionArgs: { "*": ["--fallback", "{permissionMode}"] } }, "pending-command").descriptor!;
  const wildcardCommand = buildDescriptorCommand(wildcard, { ...context, permissionMode: "plan" });
  assert.deepEqual(wildcardCommand.args.slice(4, 6), ["--fallback", "plan"]);

  const stdin = validateDescriptor({ ...raw, prompt: { mode: "stdin" } }, "pending-command").descriptor!;
  assert.equal(buildDescriptorCommand(stdin, context).stdin, "prompt {workdir}");
  const template = validateDescriptor({ ...raw, argTemplate: ["run", "{prompt}"], prompt: { mode: "template" } }, "pending-command").descriptor!;
  assert.deepEqual(buildDescriptorCommand(template, context).args, [
    "run", "prompt {workdir}", "--safe", "--cwd", "/tmp/work", "--model", "model-x", "--turns", "7", "--extra",
  ]);
});

test("generic JSONL and text adapters preserve mapped evidence", () => {
  const raw = {
    id: "pending-generic",
    label: "Pending generic",
    binNames: ["pending-generic"] as string[],
    parser: "generic-jsonl",
    fields: { finalText: "answer", durationMs: "duration", inputTokens: "usage.in", outputTokens: "usage.out", toolCallName: "tool.name", toolCallId: "tool.id", toolCallInput: "tool.input", toolCallOutput: "tool.output", toolCallError: "tool.error" },
    argTemplate: ["{prompt}"],
  } as Record<string, unknown>;
  const { descriptor, issues } = validateDescriptor(raw, "pending-generic");
  assert.deepEqual(issues, []);
  const acc = accumulator();
  assert.equal(parseGenericJsonlLine(JSON.stringify({ tool: { name: "shell", id: "t1", input: "{\"cmd\":\"pwd\"}" } }), acc, descriptor!).length, 1);
  assert.equal(acc.toolCalls[0].name, "shell");
  assert.deepEqual(acc.toolCalls[0].input, { cmd: "pwd" });
  parseGenericJsonlLine(JSON.stringify({ tool: { id: "t1", output: "ok", error: "false" } }), acc, descriptor!);
  parseGenericJsonlLine(JSON.stringify({ answer: "done", duration: 12, usage: { in: 3, out: 4 }, type: "result" }), acc, descriptor!);
  assert.equal(acc.finalText, "done");
  assert.equal(acc.result?.usage?.inputTokens, 3);
  assert.equal(acc.result?.usage?.outputTokens, 4);
  const textRaw = { id: "pending-text", label: "Pending text", binNames: ["pending-text"], parser: "text", argTemplate: ["{prompt}"] } as Record<string, unknown>;
  const textDescriptor = validateDescriptor(textRaw, "pending-text").descriptor!;
  const adapter = makeGenericAdapter(textDescriptor);
  const textAcc = accumulator();
  adapter.parseLine("plain answer", textAcc);
  assert.equal(textAcc.finalText, "plain answer");
});

test("run manifests capture harness, defaults, and repository identity", async () => {
  const manifest = await collectRunManifest("ncode", "glm-5.2", { harnessWasDefault: true, modelWasDefault: true, modelDefaultSource: "descriptor" });
  assert.equal(manifest.harness.id, "ncode");
  assert.equal(manifest.model, "glm-5.2");
  assert.deepEqual(manifest.defaultsApplied, ["harness:ncode (registry default)", "model:glm-5.2 (descriptor)"]);
  assert.match(manifest.openevalVersion, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.repo.gitSha === null || /^[0-9a-f]{7,40}$/.test(manifest.repo.gitSha));
});

test("tmux runner completes a descriptor-defined local harness command", async (t) => {
  if (!fsSync.existsSync("/Users/ianzvirbulis/.homebrew/bin/tmux")) {
    t.skip("tmux is not installed");
    return;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openeval-tmux-"));
  const script = path.join(dir, "fake-ncode");
  await fs.writeFile(script, `#!/bin/sh
printf '%s\\n' '{"type":"system","subtype":"init","session_id":"tmux-gap"}'
printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"tmux ok"}]}}'
printf '%s\\n' '{"type":"result","result":"tmux ok","duration_ms":5,"usage":{"input_tokens":1,"output_tokens":2},"session_id":"tmux-gap"}'
`);
  await fs.chmod(script, 0o755);
  const previous = process.env.NCODE_BIN;
  process.env.NCODE_BIN = script;
  try {
    const ctx = { caseId: "tmux-gap", workdir: dir, prompt: "say ok", maxTurns: 1, timeoutMs: 5000, permissionMode: "default", extraArgs: [], harness: "ncode" } satisfies RunnerContext;
    const result = await new TmuxRunner().run(ctx);
    assert.equal(result.exitCode, 0);
    assert.equal(result.finalText, "tmux ok");
    assert.equal(result.sessionId, "tmux-gap");
  } finally {
    if (previous == null) delete process.env.NCODE_BIN; else process.env.NCODE_BIN = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("artifact preview classifies and sandboxes supported content types", () => {
  assert.equal(artifactKind("card.svg", "<svg></svg>"), "svg");
  assert.equal(artifactKind("page.html", "<html><body>ok</body></html>"), "html");
  assert.equal(artifactKind("notes.txt", "plain <svg-looking text"), "text");
});
