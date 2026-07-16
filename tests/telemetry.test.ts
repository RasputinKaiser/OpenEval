import assert from "node:assert/strict";
import test from "node:test";
import { parseStreamLine } from "../lib/runner/parse";
import { caseTelemetry } from "../lib/summary";
import type { RunCaseRecord, RunnerResult, TranscriptEntry } from "../lib/types";

test("parseStreamLine records tool duration and exact final token segment", async () => {
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  try {
    const acc = {
      startedAt: 1_000,
      transcript: [] as TranscriptEntry[],
      toolCalls: [] as RunnerResult["toolCalls"],
      finalText: "",
      result: null as Partial<RunnerResult> | null,
    };

    parseStreamLine(JSON.stringify({ type: "system", subtype: "init", session_id: "s1", model: "m1" }), acc);
    parseStreamLine(JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "tool-1", name: "Write", input: { file_path: "x" } }] },
    }), acc);

    now = 1_275;
    parseStreamLine(JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "ok" }] },
    }), acc);

    now = 2_000;
    parseStreamLine(JSON.stringify({
      type: "result",
      duration_ms: 1_000,
      usage: { input_tokens: 80, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 0 },
      total_cost_usd: 0.01,
      num_turns: 1,
      result: "done",
    }), acc);

    assert.equal(acc.toolCalls[0]?.durationMs, 275);
    assert.equal(acc.result?.tokenSegments?.length, 1);
    assert.equal(acc.result?.tokenSegments?.[0]?.cumulativeOutput, 20);
    assert.equal(acc.result?.tokenSegments?.[0]?.outTokPerSec, 20);
  } finally {
    Date.now = originalNow;
  }
});

test("parseStreamLine preserves measured per-message token segments", () => {
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  try {
    const acc = {
      startedAt: 1_000,
      transcript: [] as TranscriptEntry[],
      toolCalls: [] as RunnerResult["toolCalls"],
      finalText: "",
      result: null as Partial<RunnerResult> | null,
    };
    parseStreamLine(JSON.stringify({ type: "system", subtype: "init", session_id: "s-segments", model: "m1" }), acc);
    now = 2_000;
    parseStreamLine(JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "one" }], usage: { input_tokens: 10, output_tokens: 2 } },
    }), acc);
    now = 4_000;
    parseStreamLine(JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "two" }], usage: { input_tokens: 20, output_tokens: 8 } },
    }), acc);
    now = 5_000;
    parseStreamLine(JSON.stringify({
      type: "result",
      duration_ms: 4_000,
      usage: { input_tokens: 30, output_tokens: 10 },
      result: "done",
    }), acc);

    assert.deepEqual(acc.result?.tokenSegments?.map((segment) => ({
      cumulativeInput: segment.cumulativeInput,
      cumulativeOutput: segment.cumulativeOutput,
      deltaInput: segment.deltaInput,
      deltaOutput: segment.deltaOutput,
    })), [
      { cumulativeInput: 10, cumulativeOutput: 2, deltaInput: 10, deltaOutput: 2 },
      { cumulativeInput: 30, cumulativeOutput: 10, deltaInput: 20, deltaOutput: 8 },
    ]);
  } finally {
    Date.now = originalNow;
  }
});

test("parseStreamLine uses one aggregate segment when only final usage is measured", () => {
  const acc = {
    startedAt: 1_000,
    transcript: [] as TranscriptEntry[],
    toolCalls: [] as RunnerResult["toolCalls"],
    finalText: "",
    result: null as Partial<RunnerResult> | null,
  };
  parseStreamLine(JSON.stringify({ type: "system", subtype: "init", session_id: "s-aggregate", model: "m1" }), acc);
  parseStreamLine(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "one" }] } }), acc);
  parseStreamLine(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "two" }] } }), acc);
  parseStreamLine(JSON.stringify({
    type: "result",
    duration_ms: 1_000,
    usage: { input_tokens: 80, output_tokens: 20 },
    result: "done",
  }), acc);

  assert.equal(acc.result?.tokenSegments?.length, 1);
  assert.equal(acc.result?.tokenSegments?.[0]?.deltaInput, 80);
  assert.equal(acc.result?.tokenSegments?.[0]?.deltaOutput, 20);
});

test("caseTelemetry exposes source quality and tool timing coverage", () => {
  const runner = {
    exitCode: 0,
    durationMs: 1_000,
    startedAt: 1_000,
    endedAt: 2_000,
    transcript: [],
    toolCalls: [
      { id: "a", name: "Write", durationMs: 250 },
      { id: "b", name: "Read" },
    ],
    finalText: "",
    resultText: "",
    usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 25, cacheCreateTokens: 0, costUsd: 0.02 },
    numTurns: 2,
    stopReason: null,
    sessionId: "s1",
    model: "m1",
    isError: false,
    rawJson: null,
    tokenSegments: [],
    toolCallCounts: { Write: 1, Read: 1 },
  } satisfies RunnerResult;

  const telemetry = caseTelemetry({
    id: "row",
    run_id: "run",
    case_id: "case",
    case_name: "Case",
    category: "single-tool",
    status: "passed",
    started_at: 1_000,
    ended_at: 2_000,
    workdir_path: "/tmp",
    transcript_path: null,
    runner_kind: "headless",
    runner_result: runner,
    grader_result: null,
    evaluation: null,
    error_msg: null,
    case_def: {
      id: "case",
      category: "single-tool",
      name: "Case",
      prompt: "Do it",
      graders: [],
    },
  } satisfies RunCaseRecord);

  assert.equal(telemetry.tokPerSec, 50);
  assert.equal(telemetry.toolDurationCoverage, 0.5);
  assert.equal(telemetry.durationSource, "runner_wall");
  assert.equal(telemetry.tokenSource, "cli_usage");
  assert.equal(telemetry.toolSource, "stream_tool_events");
  assert.match(telemetry.warnings.join("\n"), /50% of tool calls/);
});
