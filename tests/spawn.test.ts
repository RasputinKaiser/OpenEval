import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendCapped, drainLineBuffer, spawnHarnessProcess } from "../lib/runner/spawn";
import { normalizeParsedResult } from "../lib/runner/headless";
import { paneCaptureDelta } from "../lib/runner/tmux";
import { parseCodexLine } from "../lib/adapters/codex";
import { estimateCostUsd } from "../lib/pricing";
import type { ParseAccumulator } from "../lib/adapters/types";
import type { RunnerResult } from "../lib/types";

test("appendCapped concatenates below the cap", () => {
  assert.equal(appendCapped("", "abc"), "abc");
  assert.equal(appendCapped("abc", "def", 100), "abcdef");
});

test("appendCapped truncates once at the cap and then stops growing", () => {
  const cap = 10;
  const first = appendCapped("012345678", "extra", cap); // len 9 + 5 crosses the cap
  assert.ok(first.startsWith("012345678"));
  assert.ok(first.includes("truncated"));
  // subsequent appends do not grow it further
  const second = appendCapped(first, "more and more output", cap);
  assert.equal(second, first);
});

test("appendCapped adds the marker exactly at the boundary crossing", () => {
  const cap = 5;
  const out = appendCapped("abc", "defgh", cap); // "abcdefgh" length 8 > 5
  assert.equal(out, "abcde\n…[output truncated]…");
});

test("appendCapped stops growing once the cap is reached", () => {
  const cap = 5;
  const full = appendCapped("", "abcde", cap); // exactly at cap, no truncation yet
  assert.equal(full, "abcde");
  // further content never grows the string past the cap
  assert.equal(appendCapped(full, "x", cap), "abcde");
  assert.ok(appendCapped(full, "x", cap).length <= cap);
});

test("drainLineBuffer emits complete lines and keeps the trailing fragment", () => {
  const lines: string[] = [];
  const rest = drainLineBuffer("a\nb\npartial", (l) => lines.push(l));
  assert.deepEqual(lines, ["a", "b"]);
  assert.equal(rest, "partial");
});

test("drainLineBuffer keeps a fragment at or below the cap", () => {
  const lines: string[] = [];
  const rest = drainLineBuffer("abc", (l) => lines.push(l), 10);
  assert.deepEqual(lines, []);
  assert.equal(rest, "abc");
});

test("drainLineBuffer flushes and resets an oversized newline-less fragment", () => {
  const lines: string[] = [];
  const rest = drainLineBuffer("x".repeat(20), (l) => lines.push(l), 10);
  assert.deepEqual(lines, ["x".repeat(20)]);
  assert.equal(rest, "");
  // subsequent chunks start from an empty buffer instead of growing forever
  const more: string[] = [];
  assert.equal(drainLineBuffer(rest + "y".repeat(11), (l) => more.push(l), 10), "");
  assert.deepEqual(more, ["y".repeat(11)]);
});

test("Codex failure diagnostics stay out of finalText", () => {
  const acc: ParseAccumulator = { startedAt: Date.now(), transcript: [], toolCalls: [], finalText: "", result: null };
  parseCodexLine(JSON.stringify({ type: "turn.failed", error: { message: "SECRET_DIAGNOSTIC" } }), acc);
  assert.equal(acc.result?.isError, true);
  assert.equal(acc.result?.finalText, "");
  assert.equal(acc.result?.resultText, "SECRET_DIAGNOSTIC");
});

test("Codex turn usage splits cached input from fresh input", () => {
  const acc: ParseAccumulator = { startedAt: Date.now(), transcript: [], toolCalls: [], finalText: "", result: null };
  parseCodexLine(JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: 1_000, cached_input_tokens: 750, output_tokens: 40 },
  }), acc);

  assert.equal(acc.result?.usage?.inputTokens, 250);
  assert.equal(acc.result?.usage?.cacheReadTokens, 750);
  assert.equal(
    (acc.result?.usage?.inputTokens ?? 0) + (acc.result?.usage?.cacheReadTokens ?? 0),
    1_000,
  );
});

test("headless results ground missing Codex model and cost in the requested model", () => {
  const acc: ParseAccumulator = { startedAt: Date.now(), transcript: [], toolCalls: [], finalText: "", result: null };
  parseCodexLine(JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: 1_000, cached_input_tokens: 750, output_tokens: 40 },
  }), acc);

  const result = normalizeParsedResult(acc.result as RunnerResult, "gpt-5.5");
  assert.equal(result.model, "gpt-5.5");
  assert.equal(result.usage.costSource, "inferred");
  assert.equal(result.usage.costUsd, estimateCostUsd("gpt-5.5", {
    input: 250,
    output: 40,
    cacheRead: 750,
    cacheCreate: 0,
  }));
});

test("runner normalization preserves an explicitly measured zero cost", () => {
  const acc: ParseAccumulator = { startedAt: Date.now(), transcript: [], toolCalls: [], finalText: "", result: null };
  parseCodexLine(JSON.stringify({ type: "turn.completed", usage: {} }), acc);
  const parsed = acc.result as RunnerResult;
  const result = normalizeParsedResult({
    ...parsed,
    usage: {
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      costUsd: 0,
      costSource: "measured",
    },
  }, "gpt-5.5");

  assert.equal(result.model, "gpt-5.5");
  assert.equal(result.usage.costUsd, 0);
  assert.equal(result.usage.costSource, "measured");
});

test("runner normalization rejects synthetic model sentinels and unannotated costs", () => {
  const acc: ParseAccumulator = { startedAt: Date.now(), transcript: [], toolCalls: [], finalText: "", result: null };
  parseCodexLine(JSON.stringify({ type: "turn.completed", usage: {} }), acc);
  const base = {
    ...(acc.result as RunnerResult),
    model: "<synthetic>",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      costUsd: 12.34,
    },
  };
  const result = normalizeParsedResult(base, null);
  assert.equal(result.model, null);
  assert.equal(result.usage.costUsd, 0);
  assert.equal(result.usage.costSource, "missing");
});

test("runner normalization uses the requested model instead of a synthetic sentinel", () => {
  const acc: ParseAccumulator = { startedAt: Date.now(), transcript: [], toolCalls: [], finalText: "", result: null };
  parseCodexLine(JSON.stringify({ type: "turn.completed", usage: {} }), acc);
  const base = {
    ...(acc.result as RunnerResult),
    model: "<synthetic>",
    usage: {
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      costUsd: 99,
    },
  };
  const result = normalizeParsedResult(base, "gpt-5.5");
  assert.equal(result.model, "gpt-5.5");
  assert.equal(result.usage.costSource, "inferred");
  assert.equal(result.usage.costUsd, estimateCostUsd("gpt-5.5", { input: 100, output: 10, cacheRead: 0, cacheCreate: 0 }));
});

// ---- spawnHarnessProcess subprocess lifecycle ----

function makeExecutable(dir: string, name: string, body: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body, { mode: 0o755 });
  fs.chmodSync(file, 0o755);
  return file;
}

function ncodeCtx(dir: string, timeoutMs: number) {
  return {
    caseId: "spawn-regression",
    workdir: dir,
    prompt: "noop",
    maxTurns: 1,
    timeoutMs,
    permissionMode: "default" as const,
    extraArgs: [] as string[],
    harness: "ncode",
  };
}

test("spawnHarnessProcess does not crash when onLine throws on every line", async () => {
  // Regression: an uncaught throw from onLine (adapter.parseLine → onEvent →
  // synchronous SQLite appendEvent, e.g. SQLITE_BUSY) inside the stdout 'data'
  // handler would abort the whole eval process and kill all parallel workers.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-spawn-"));
  const prevBin = process.env.NCODE_BIN;
  try {
    process.env.NCODE_BIN = makeExecutable(
      dir,
      "fake-ncode.sh",
      "#!/bin/sh\nprintf '{\"type\":\"a\"}\\n'\nprintf 'second line\\n'\nexit 0\n",
    );
    let calls = 0;
    const result = await spawnHarnessProcess(ncodeCtx(dir, 10_000), () => {
      calls += 1;
      throw new Error("appendEvent blew up (SQLITE_BUSY)");
    });
    assert.ok(calls > 0, "onLine should have been invoked");
    assert.equal(result.timedOut, false);
    assert.equal(result.aborted, false);
    assert.equal(result.exitCode, 0);
  } finally {
    if (prevBin === undefined) delete process.env.NCODE_BIN;
    else process.env.NCODE_BIN = prevBin;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("spawnHarnessProcess escalates to SIGKILL and resolves a SIGTERM-ignoring child on timeout", async () => {
  // Regression: killProcessGroup used to send SIGKILL only; a child that traps
  // SIGTERM still dies, but the run must escalate and resolve rather than hang.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-spawn-"));
  const prevBin = process.env.NCODE_BIN;
  try {
    process.env.NCODE_BIN = makeExecutable(
      dir,
      "stubborn-ncode.sh",
      "#!/bin/sh\ntrap '' TERM\nwhile true; do sleep 0.2; done\n",
    );
    const start = Date.now();
    const result = await spawnHarnessProcess(ncodeCtx(dir, 300), () => {});
    assert.equal(result.timedOut, true);
    // Resolves after the timeout + SIGTERM→SIGKILL grace, but well before hanging.
    assert.ok(Date.now() - start < 20_000, "kill path must resolve promptly");
  } finally {
    if (prevBin === undefined) delete process.env.NCODE_BIN;
    else process.env.NCODE_BIN = prevBin;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("paneCaptureDelta avoids reparsing an unchanged final tmux snapshot", () => {
  assert.equal(paneCaptureDelta("line one\nline two\n", "line one\nline two\n"), "");
  assert.equal(paneCaptureDelta("line one\n", "line one\nline two\n"), "line two\n");
  assert.equal(paneCaptureDelta("scrolled one\nline two\n", "line two\nline three\n"), "line three\n");
});
