import test, { after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _setCacheDbForTest } from "../lib/live-cache";
import {
  compactDisplayPath,
  parseSessionTranscript,
  isPathInLiveSource,
  redactSensitiveText,
  scanLiveSessions,
  scanSourceSessions,
  summarizeCodexSessionFile,
  summarizeLiveSessionFile,
} from "../lib/live";
import { HARNESS_DESC_DIR } from "../lib/config";
import { JUDGE_PROMPT_MARKER } from "../lib/insights/signals";
import { estimateCostUsd } from "../lib/pricing";
import { GET as liveGet } from "../app/api/live/route";

// Parsing goes through the live-cache; point it at a throwaway in-memory DB so
// parallel test processes never race on the shared .test-data SQLite cache.
const cacheConn = new Database(":memory:");
_setCacheDbForTest(cacheConn);
after(() => {
  _setCacheDbForTest(null);
  cacheConn.close();
});

function writeSession(lines: unknown[], extras: string[] = []): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-live-"));
  const file = path.join(dir, "session.jsonl");
  fs.writeFileSync(
    file,
    [
      ...lines.map((line) => JSON.stringify(line)),
      ...extras,
    ].join("\n"),
    "utf8",
  );
  return file;
}

test("parseSessionTranscript opens Hermes single-JSON sessions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-hermes-transcript-"));
  const file = path.join(dir, "session_20260715_000000_demo.json");
  fs.writeFileSync(file, JSON.stringify({
    session_id: "hermes-transcript",
    model: "gpt-5.5",
    session_start: "2026-07-15T00:00:00.000Z",
    last_updated: "2026-07-15T00:00:03.000Z",
    messages: [
      { role: "user", content: "inspect the image" },
      { role: "assistant", content: "I will inspect it.", tool_calls: [{ id: "tool-1", function: { name: "bash", arguments: "{\"cmd\":\"file image.png\"}" } }] },
      { role: "tool", tool_call_id: "tool-1", content: "image.png: PNG image data", is_error: true },
      { role: "assistant", content: "The tool reported an error." },
    ],
  }, null, 2));
  try {
    const parsed = parseSessionTranscript(file, "hermes-json");
    assert.equal(parsed.error, undefined);
    assert.ok(parsed.turns.some((turn) => turn.label === "You"));
    assert.ok(parsed.turns.some((turn) => turn.label === "Tool: bash"));
    assert.ok(parsed.turns.some((turn) => turn.label === "Tool result — error"));
    assert.equal(parsed.turns.some((turn) => turn.type === "malformed"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("summarizeLiveSessionFile parses observed ncode sessions without result events", () => {
  const file = writeSession([
    {
      type: "system",
      sessionId: "sess-123",
      cwd: "/Users/ralto/Documents/AgentEvals",
      durationMs: 2500,
      totalDurationMs: 4000,
      stopReason: "completed",
      hookErrors: 2,
      messageCount: 7,
      userType: "human",
      timestamp: "2026-06-28T20:00:00.000Z",
    },
    {
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "checking the repo" },
          { type: "text", text: "I found it." },
          { type: "tool_use", id: "tool-1", name: "shell", input: { cmd: "npm test" } },
        ],
      },
    },
    {
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "tool-1", content: "boom", is_error: true },
        ],
      },
    },
    { type: "attachment" },
    { type: "queue-operation" },
    { type: "file-history-snapshot" },
  ]);

  const session = summarizeLiveSessionFile(file, "-Users-ralto-Documents-AgentEvals", Date.parse("2026-06-28T20:01:00.000Z"));

  assert.ok(session);
  assert.equal(session.sessionId, "sess-123");
  assert.equal(session.project, "/Users/ralto/Documents/AgentEvals");
  assert.equal(session.model, null);
  assert.equal(session.metricSources.model, "missing");
  assert.equal(session.metricSources.tokens, "missing");
  assert.equal(session.metricSources.cost, "missing");
  assert.equal(session.metricSources.duration, "measured");
  assert.equal(session.durationMs, 4000);
  assert.equal(session.toolCalls, 1);
  assert.equal(session.toolErrors, 1);
  assert.equal(session.thinkingBlocks, 1);
  assert.equal(session.textBlocks, 1);
  assert.equal(session.attachmentCount, 1);
  assert.equal(session.queueOperationCount, 1);
  assert.equal(session.snapshotCount, 1);
  assert.equal(session.hookErrors, 2);
  assert.equal(session.numTurns, 7);
  assert.ok(session.dataQuality < 100);
  assert.ok(session.parseWarnings.some((warning) => warning.includes("model missing")));

  const hiddenFile = writeSession([{ type: "system", sessionId: "hidden-project" }]);
  const hiddenProject = summarizeLiveSessionFile(hiddenFile, "-Users-ralto--ncode", Date.parse("2026-06-28T20:01:00.000Z"));
  assert.equal(hiddenProject?.project, "/Users/ralto/.ncode");
});

test("summarizeLiveSessionFile reports malformed lines and measured result metrics", () => {
  const file = writeSession([
    { type: "system", session_id: "legacy-session", model: "glm-5.2" },
    {
      type: "result",
      duration_ms: 1200,
      num_turns: 3,
      stop_reason: "stop",
      total_cost_usd: 0.031,
      usage: { input_tokens: 100, output_tokens: 25, cache_read_input_tokens: 10 },
    },
  ], ["{not json"]);

  const session = summarizeLiveSessionFile(file, "-Users-ralto-Documents-AgentEvals", 1000);

  assert.ok(session);
  assert.equal(session.malformedLineCount, 1);
  assert.equal(session.metricSources.model, "measured");
  assert.equal(session.metricSources.tokens, "measured");
  assert.equal(session.metricSources.cost, "measured");
  assert.equal(session.metricSources.duration, "measured");
  assert.equal(session.inputTokens, 100);
  assert.equal(session.outputTokens, 25);
  assert.equal(session.costUsd, 0.031);
  assert.equal(session.cacheReadTokens, 10);
  assert.equal(session.cacheCreateTokens, 0);
  assert.equal(session.totalTokens, 135);
  assert.equal(session.usageSegments.length, 1);
  assert.ok(session.parseWarnings.some((warning) => warning.includes("malformed")));
});

test("summarizeLiveSessionFile caches summaries across calls for unchanged files", () => {
  const file = writeSession([
    {
      type: "system",
      sessionId: "cache-hit",
      cwd: "/Users/ralto/Documents/AgentEvals",
      timestamp: "2026-06-28T20:00:00.000Z",
    },
    {
      type: "result",
      duration_ms: 1500,
      num_turns: 2,
      stop_reason: "stop",
      total_cost_usd: 0.02,
      usage: { input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 5 },
    },
  ]);

  const first = summarizeLiveSessionFile(file, "-Users-ralto-Documents-AgentEvals", Date.parse("2026-06-28T20:00:00.000Z"));
  const second = summarizeLiveSessionFile(file, "-Users-ralto-Documents-AgentEvals", Date.parse("2026-06-28T20:00:00.000Z"));
  assert.ok(first);
  assert.ok(second);
  // Cache hits return a fresh copy with staleMs recomputed (a persisted cache
  // must not freeze staleness), so compare content rather than identity.
  assert.deepEqual({ ...second, staleMs: 0 }, { ...first, staleMs: 0 }, "expected the cache to return the same summary for an unchanged file");
  assert.equal(second.inputTokens, 50);
});

test("summarizeLiveSessionFile pairs tool_use with tool_result to measure durations", () => {
  const file = writeSession([
    {
      type: "assistant",
      sessionId: "durations",
      cwd: "/Users/ralto/Documents/AgentEvals",
      timestamp: "2026-06-28T20:00:00.000Z",
      message: {
        content: [
          { type: "tool_use", id: "t-fast", name: "Read", input: { file_path: "/x" } },
        ],
      },
    },
    {
      type: "user",
      sessionId: "durations",
      timestamp: "2026-06-28T20:00:01.000Z",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "t-fast", content: "ok" },
        ],
      },
    },
    {
      type: "assistant",
      sessionId: "durations",
      timestamp: "2026-06-28T20:00:02.000Z",
      message: {
        content: [
          { type: "tool_use", id: "t-slow", name: "Bash", input: { command: "npm test" } },
        ],
      },
    },
    {
      type: "user",
      sessionId: "durations",
      timestamp: "2026-06-28T20:00:10.000Z",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "t-slow", content: "boom", is_error: true },
        ],
      },
    },
  ]);

  const session = summarizeLiveSessionFile(file, "-Users-ralto-Documents-AgentEvals", Date.parse("2026-06-28T20:00:00.000Z"));
  assert.ok(session);
  assert.equal(session.toolDurations.length, 2);

  const readRow = session.toolDurations.find((row) => row.name === "Read");
  assert.ok(readRow);
  assert.equal(readRow!.count, 1);
  assert.equal(readRow!.p50Ms, 1000);
  assert.equal(readRow!.maxMs, 1000);

  const bashRow = session.toolDurations.find((row) => row.name === "Bash");
  assert.ok(bashRow);
  assert.equal(bashRow!.count, 1);
  assert.equal(bashRow!.p50Ms, 8000);
  assert.equal(bashRow!.errors, 1);
});

test("summarizeLiveSessionFile measures ncode assistant message usage", () => {
  const file = writeSession([
    {
      type: "assistant",
      sessionId: "ncode-usage",
      cwd: "/Users/ralto/Documents/AgentEvals",
      userType: "noumena",
      entrypoint: "cli",
      gitBranch: "codex/live-usage",
      timestamp: "2026-06-28T20:00:10.000Z",
      message: {
        model: "/data/models/hf/zai-org__GLM-5.2-FP8",
        content: [
          { type: "text", text: "Measured usage is present." },
          { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "npm test" } },
        ],
        usage: {
          input_tokens: 23634,
          output_tokens: 3,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 7,
        },
      },
    },
    {
      type: "assistant",
      sessionId: "ncode-usage",
      cwd: "/Users/ralto/Documents/AgentEvals",
      userType: "noumena",
      timestamp: "2026-06-28T20:00:12.000Z",
      message: {
        content: [{ type: "text", text: "Second response." }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 2,
        },
      },
    },
  ]);

  const session = summarizeLiveSessionFile(file, "-Users-ralto-Documents-AgentEvals", Date.parse("2026-06-28T20:00:00.000Z"));

  assert.ok(session);
  assert.equal(session.sessionId, "ncode-usage");
  assert.equal(session.project, "/Users/ralto/Documents/AgentEvals");
  assert.equal(session.model, "/data/models/hf/zai-org__GLM-5.2-FP8");
  assert.equal(session.metricSources.model, "measured");
  assert.equal(session.metricSources.tokens, "measured");
  assert.equal(session.inputTokens, 23644);
  assert.equal(session.outputTokens, 8);
  assert.equal(session.cacheReadTokens, 102);
  assert.equal(session.cacheCreateTokens, 7);
  assert.equal(session.totalTokens, 23761);
  assert.equal(session.usageSegments.length, 2);
  assert.equal(session.usageSegments[1].cumulativeOutput, 8);
  assert.ok(!session.parseWarnings.some((warning) => warning.includes("token usage missing")));
});

test("mixed-model Claude sessions preserve per-model tokens, tools, and inferred cost", () => {
  const file = writeSession([
    {
      type: "assistant",
      sessionId: "mixed-model",
      cwd: "/tmp/mixed-model",
      timestamp: "2026-07-15T00:00:01.000Z",
      message: {
        model: "claude-fable-5",
        content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "false" } }],
        usage: {
          input_tokens: 100,
          output_tokens: 10,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 20,
        },
      },
    },
    {
      type: "user",
      timestamp: "2026-07-15T00:00:02.000Z",
      message: { content: [{ type: "tool_result", tool_use_id: "tool-1", is_error: true, content: "failed" }] },
    },
    {
      type: "assistant",
      timestamp: "2026-07-15T00:00:03.000Z",
      message: {
        model: "claude-opus-4-8",
        content: [{ type: "text", text: "Recovered." }],
        usage: {
          input_tokens: 5,
          output_tokens: 2,
          cache_read_input_tokens: 10,
          cache_creation_input_tokens: 1,
        },
      },
    },
  ]);

  const session = summarizeLiveSessionFile(file, "/tmp/mixed-model", Date.parse("2026-07-15T00:00:00.000Z"));
  assert.ok(session);
  assert.equal(session.model, "claude-fable-5");
  assert.deepEqual(session.modelUsage, [
    {
      model: "claude-fable-5",
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 200,
      cacheCreateTokens: 20,
      toolCalls: 1,
      toolErrors: 1,
    },
    {
      model: "claude-opus-4-8",
      inputTokens: 5,
      outputTokens: 2,
      cacheReadTokens: 10,
      cacheCreateTokens: 1,
      toolCalls: 0,
      toolErrors: 0,
    },
  ]);
  const expectedCost =
    (estimateCostUsd("claude-fable-5", { input: 100, output: 10, cacheRead: 200, cacheCreate: 20 }) ?? 0) +
    (estimateCostUsd("claude-opus-4-8", { input: 5, output: 2, cacheRead: 10, cacheCreate: 1 }) ?? 0);
  assert.equal(session.costUsd, expectedCost);

  try {
    const aggregate = scanSourceSessions({
      id: "tmp-mixed-model",
      label: "Temporary Mixed Model Source",
      roots: [path.dirname(file)],
      format: "jsonl-dir",
      maxDepth: 1,
    }, 10);
    const fable = aggregate.byModel.find((row) => row.model === "claude-fable-5");
    const opus = aggregate.byModel.find((row) => row.model === "claude-opus-4-8");
    assert.ok(fable, JSON.stringify(aggregate.byModel));
    assert.ok(opus, JSON.stringify(aggregate.byModel));
    assert.equal(fable?.inputTokens, 100);
    assert.equal(fable?.toolCalls, 1);
    assert.equal(fable?.errors, 1);
    assert.equal(opus?.inputTokens, 5);
    assert.equal(opus?.toolCalls, 0);
    assert.ok(Math.abs((fable?.costUsd ?? 0) + (opus?.costUsd ?? 0) - expectedCost) < 1e-12);
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

test("measured mixed-model session costs are labeled as allocated in model rollups", () => {
  const file = writeSession([
    {
      type: "assistant",
      timestamp: "2026-07-15T00:00:00.000Z",
      message: { model: "claude-fable-5", content: [{ type: "text", text: "one" }], usage: { input_tokens: 100, output_tokens: 10 } },
    },
    {
      type: "assistant",
      timestamp: "2026-07-15T00:00:01.000Z",
      message: { model: "claude-opus-4-8", content: [{ type: "text", text: "two" }], usage: { input_tokens: 50, output_tokens: 5 } },
    },
    { type: "result", timestamp: "2026-07-15T00:00:02.000Z", total_cost_usd: 0.12, duration_ms: 2000 },
  ]);
  try {
    const aggregate = scanSourceSessions({
      id: "tmp-measured-mixed-model",
      label: "Temporary Measured Mixed Model Source",
      roots: [path.dirname(file)],
      format: "jsonl-dir",
      maxDepth: 1,
    }, 10);
    const fable = aggregate.byModel.find((row) => row.model === "claude-fable-5");
    const opus = aggregate.byModel.find((row) => row.model === "claude-opus-4-8");
    assert.ok(fable);
    assert.ok(opus);
    assert.equal(fable.measuredCostSessions, 0);
    assert.equal(opus.measuredCostSessions, 0);
    assert.equal(fable.allocatedCostSessions, 1);
    assert.equal(opus.allocatedCostSessions, 1);
    assert.ok(Math.abs(fable.costUsd + opus.costUsd - 0.12) < 1e-12);
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

test("Claude subagent worktree transcripts derive a unique child identity", () => {
  const file = writeSession([
    {
      type: "user",
      timestamp: "2026-07-15T00:00:00.000Z",
      sessionId: "parent-session",
      uuid: "child-user",
      parentUuid: null,
      isSidechain: true,
      agentId: "a51a701450616629b",
      cwd: "/tmp/repo/.claude/worktrees/child-worktree",
      message: { content: "Inspect the fixture" },
    },
    {
      type: "assistant",
      timestamp: "2026-07-15T00:00:01.000Z",
      sessionId: "parent-session",
      uuid: "child-assistant",
      parentUuid: "child-user",
      isSidechain: true,
      agentId: "a51a701450616629b",
      cwd: "/tmp/repo/.claude/worktrees/child-worktree",
      message: { model: "claude-sonnet-5", content: [{ type: "text", text: "done" }], usage: { input_tokens: 10, output_tokens: 2 } },
    },
  ]);
  const session = summarizeLiveSessionFile(file, "/tmp/project", Date.parse("2026-07-15T00:00:00.000Z"));
  assert.ok(session);
  assert.equal(session.sessionId, "parent-session/agent-a51a701450616629b");
  assert.equal(session.project, "/tmp/repo/.claude/worktrees/child-worktree");
  assert.equal(session.traceGraph.agentCount, 1);
  assert.ok(session.parseWarnings.includes("source: subagent"));
});

test("scanLiveSessions reads descriptor liveTrace usage without fabricating missing values", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-live-source-"));
  const descPath = path.join(HARNESS_DESC_DIR, `tmp-live-${Date.now()}.harness.json`);
  fs.mkdirSync(HARNESS_DESC_DIR, { recursive: true });
  fs.writeFileSync(path.join(root, "session.jsonl"), JSON.stringify({
    type: "done",
    session_id: "descriptor-session",
    model: "descriptor-model",
    duration_ms: 2000,
    num_turns: 4,
    usage: {
      input_tokens: 80,
      output_tokens: 20,
      cache_read_input_tokens: 5,
      cache_creation_input_tokens: 7,
      cost_usd: 0.0123,
    },
    stop_reason: "completed",
    is_error: false,
  }), "utf8");
  fs.writeFileSync(descPath, JSON.stringify({
    id: "tmp-live-source",
    label: "Temporary Live Source",
    binNames: ["tmp-live-source"],
    output: "jsonl",
    argTemplate: ["run"],
    fields: {
      sessionId: "session_id",
      model: "model",
      durationMs: "duration_ms",
      numTurns: "num_turns",
      inputTokens: "usage.input_tokens",
      outputTokens: "usage.output_tokens",
      cacheReadTokens: "usage.cache_read_input_tokens",
      cacheCreateTokens: "usage.cache_creation_input_tokens",
      costUsd: "usage.cost_usd",
      stopReason: "stop_reason",
      isError: "is_error",
    },
    liveTrace: {
      roots: [root],
      maxDepth: 1,
    },
  }), "utf8");

  try {
    const data = scanLiveSessions(10, "tmp-live-source");
    assert.equal(data.sourceHarness, "tmp-live-source");
    assert.equal(data.sourceStatus, "available");
    assert.equal(data.totalSessions, 1);
    assert.equal(data.usageSummary.totalInputTokens, 80);
    assert.equal(data.usageSummary.totalOutputTokens, 20);
    assert.equal(data.usageSummary.totalCacheReadTokens, 5);
    assert.equal(data.usageSummary.totalCacheCreateTokens, 7);
    assert.equal(data.usageSummary.totalTokens, 112);
    assert.equal(data.usageSummary.totalCostUsd, 0.0123);
    assert.equal(data.usageSummary.sessionsWithMeasuredUsage, 1);
    assert.equal(data.usageSummary.sessionsWithMeasuredCost, 1);
    assert.equal(data.usageSummary.tokenCoverage, 1);
    assert.equal(data.sessions[0].usageSegments.length, 1);
    assert.ok(isPathInLiveSource(path.join(root, "session.jsonl"), "tmp-live-source"));
    assert.equal(isPathInLiveSource(path.join(os.tmpdir(), "outside.jsonl"), "tmp-live-source"), false);
  } finally {
    fs.rmSync(descPath, { force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("summarizeCodexSessionFile sums per-turn usage across a context reset (compaction)", () => {
  // last_token_usage is per turn; total_token_usage resets when the context is
  // compacted. Max-of-cumulative would undercount; billed = sum of per-turn.
  const turn = (t: string, input: number, cached: number, output: number, totalIn: number) => ({
    timestamp: t,
    type: "event_msg",
    payload: { type: "token_count", info: {
      last_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output },
      total_token_usage: { input_tokens: totalIn, cached_input_tokens: cached, output_tokens: output },
    } },
  });
  const file = writeSession([
    { timestamp: "2026-06-29T00:00:00.000Z", type: "session_meta", payload: { id: "s", model: "gpt-5.5" } },
    turn("2026-06-29T00:00:01.000Z", 1000, 200, 50, 1000), // cumulative 1000
    turn("2026-06-29T00:00:02.000Z", 1000, 400, 50, 400),  // reset: total drops to 400
  ]);
  const session = summarizeCodexSessionFile(file, "2026/06/29", Date.parse("2026-06-29T00:00:00.000Z"));
  assert.ok(session);
  // summed input = 2000, summed cached = 600 → fresh = 1400, cacheRead = 600, output = 100
  assert.equal(session.cacheReadTokens, 600);
  assert.equal(session.inputTokens, 1400);
  assert.equal(session.outputTokens, 100);
  assert.equal(session.totalTokens, 2100); // 1400 + 100 + 600 = summed input(2000) + output(100)
  assert.equal(session.usageSegments.reduce((sum, segment) => sum + segment.deltaInput, 0), 1400);
  assert.equal(session.usageSegments.reduce((sum, segment) => sum + segment.deltaOutput, 0), 100);
  assert.equal(session.usageSegments.at(-1)?.cumulativeInput, 1400);
  assert.equal(session.usageSegments.at(-1)?.cumulativeOutput, 100);
});

test("summarizeCodexSessionFile preserves legacy cumulative totals across a reset", () => {
  const total = (t: string, input: number, cached: number, output: number) => ({
    timestamp: t,
    type: "event_msg",
    payload: { type: "token_count", info: {
      total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output },
    } },
  });
  const file = writeSession([
    { timestamp: "2026-06-29T00:00:00.000Z", type: "session_meta", payload: { id: "legacy-reset", model: "gpt-5.5" } },
    total("2026-06-29T00:00:01.000Z", 1000, 200, 50),
    total("2026-06-29T00:00:02.000Z", 400, 100, 25),
  ]);

  const session = summarizeCodexSessionFile(file, "2026/06/29", Date.parse("2026-06-29T00:00:00.000Z"));
  assert.ok(session);
  assert.equal(session.inputTokens, 1100);
  assert.equal(session.cacheReadTokens, 300);
  assert.equal(session.outputTokens, 75);
  assert.equal(session.totalTokens, 1475);
  assert.equal(session.usageSegments.reduce((sum, segment) => sum + segment.deltaInput, 0), 1100);
  assert.equal(session.usageSegments.at(-1)?.cumulativeOutput, 75);
});

test("summarizeCodexSessionFile does not drop a cumulative-only event after exact turn usage", () => {
  const file = writeSession([
    { timestamp: "2026-06-29T00:00:00.000Z", type: "session_meta", payload: { id: "mixed-usage-shape", model: "gpt-5.5" } },
    { timestamp: "2026-06-29T00:00:01.000Z", type: "event_msg", payload: { type: "token_count", info: {
      last_token_usage: { input_tokens: 1000, cached_input_tokens: 900, output_tokens: 20 },
      total_token_usage: { input_tokens: 1000, cached_input_tokens: 900, output_tokens: 20 },
    } } },
    { timestamp: "2026-06-29T00:00:02.000Z", type: "event_msg", payload: { type: "token_count", info: {
      total_token_usage: { input_tokens: 1100, cached_input_tokens: 900, output_tokens: 30 },
    } } },
  ]);

  const session = summarizeCodexSessionFile(file, "2026/06/29", Date.parse("2026-06-29T00:00:00.000Z"));
  assert.ok(session);
  assert.equal(session.inputTokens, 200);
  assert.equal(session.cacheReadTokens, 900);
  assert.equal(session.outputTokens, 30);
  assert.equal(session.usageSegments.at(-1)?.cumulativeInput, 200);
  assert.equal(session.usageSegments.at(-1)?.cumulativeOutput, 30);
});

test("summarizeCodexSessionFile keeps the root identity when fork context embeds parent metadata", () => {
  const file = writeSession([
    {
      timestamp: "2026-07-15T01:53:29.638Z",
      type: "session_meta",
      payload: {
        id: "child-thread",
        session_id: "parent-thread",
        cwd: "/tmp/child",
        originator: "Codex Desktop",
        cli_version: "0.144.2",
        thread_source: "subagent",
        source: { subagent: { thread_spawn: { parent_thread_id: "parent-thread" } } },
      },
    },
    {
      timestamp: "2026-07-15T01:53:29.640Z",
      type: "session_meta",
      payload: { id: "parent-thread", cwd: "/tmp/parent", originator: "Codex Desktop", source: "vscode" },
    },
    { timestamp: "2026-07-15T01:53:30.000Z", type: "event_msg", payload: { type: "agent_message", message: "done" } },
  ]);

  const session = summarizeCodexSessionFile(file, "2026/07/15", Date.parse("2026-07-15T01:53:29.000Z"));
  assert.ok(session);
  assert.equal(session.sessionId, "child-thread");
  assert.equal(session.project, "/tmp/child");
  assert.ok(session.parseWarnings.includes("source: Codex Desktop / subagent 0.144.2"));
});

test("summarizeCodexSessionFile rejects placeholder models from metadata and turn context", () => {
  const file = writeSession([
    { timestamp: "2026-07-15T00:00:00.000Z", type: "session_meta", payload: { id: "placeholder-codex", model: "<synthetic>" } },
    { timestamp: "2026-07-15T00:00:00.500Z", type: "turn_context", payload: { model: "unknown" } },
    { timestamp: "2026-07-15T00:00:01.000Z", type: "event_msg", payload: { type: "token_count", info: {
      last_token_usage: { input_tokens: 100, cached_input_tokens: 50, output_tokens: 10 },
      total_token_usage: { input_tokens: 100, cached_input_tokens: 50, output_tokens: 10 },
    } } },
  ]);

  const session = summarizeCodexSessionFile(file, "2026/07/15", Date.parse("2026-07-15T00:00:00.000Z"));
  assert.ok(session);
  assert.equal(session.model, null);
  assert.equal(session.metricSources.model, "missing");
  assert.equal(session.metricSources.cost, "missing");
  assert.equal(session.costUsd, 0);
  assert.deepEqual(session.modelUsage ?? [], []);
});

test("summarizeLiveSessionFile rejects generic placeholder models and uses a real descriptor fallback", () => {
  const file = writeSession([
    {
      meta: { model: "<synthetic>" },
      usage: { input: 100, output: 10 },
      timestamp: "2026-07-15T00:00:00.000Z",
    },
  ]);

  const session = summarizeLiveSessionFile(file, "/tmp/generic-placeholder", Date.parse("2026-07-15T00:00:00.000Z"), {
    fields: {
      model: "meta.model",
      inputTokens: "usage.input",
      outputTokens: "usage.output",
    },
    inferredModel: "gpt-5.5",
    decodeProject: false,
  });
  assert.ok(session);
  assert.equal(session.model, "gpt-5.5");
  assert.equal(session.metricSources.model, "inferred");
  assert.equal(session.metricSources.cost, "inferred");
  assert.equal(session.costUsd, estimateCostUsd("gpt-5.5", { input: 100, output: 10, cacheRead: 0, cacheCreate: 0 }));
});

test("mixed-model Codex sessions attribute per-turn usage and tools to the active model", () => {
  const file = writeSession([
    { timestamp: "2026-07-15T00:00:00.000Z", type: "session_meta", payload: { id: "codex-mixed", model: "gpt-5.5" } },
    { timestamp: "2026-07-15T00:00:00.500Z", type: "turn_context", payload: { model: "gpt-5.5" } },
    { timestamp: "2026-07-15T00:00:01.000Z", type: "response_item", payload: { type: "function_call", call_id: "call-1", name: "exec_command", arguments: "{}" } },
    { timestamp: "2026-07-15T00:00:01.500Z", type: "response_item", payload: { type: "function_call_output", call_id: "call-1", output: "Exit code: 1\nOutput:\nfailed" } },
    { timestamp: "2026-07-15T00:00:02.000Z", type: "event_msg", payload: { type: "token_count", info: {
      last_token_usage: { input_tokens: 1000, cached_input_tokens: 900, output_tokens: 20 },
      total_token_usage: { input_tokens: 1000, cached_input_tokens: 900, output_tokens: 20 },
    } } },
    { timestamp: "2026-07-15T00:00:03.000Z", type: "turn_context", payload: { model: "gpt-5.4" } },
    { timestamp: "2026-07-15T00:00:04.000Z", type: "event_msg", payload: { type: "token_count", info: {
      last_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 10 },
      total_token_usage: { input_tokens: 1100, cached_input_tokens: 900, output_tokens: 30 },
    } } },
  ]);

  const session = summarizeCodexSessionFile(file, "2026/07/15", Date.parse("2026-07-15T00:00:00.000Z"));
  assert.ok(session);
  assert.equal(session.model, "gpt-5.5");
  assert.deepEqual(session.modelUsage, [
    {
      model: "gpt-5.5",
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 900,
      cacheCreateTokens: 0,
      toolCalls: 1,
      toolErrors: 1,
    },
    {
      model: "gpt-5.4",
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      toolCalls: 0,
      toolErrors: 0,
    },
  ]);
  const expectedCost =
    (estimateCostUsd("gpt-5.5", { input: 100, output: 20, cacheRead: 900, cacheCreate: 0 }) ?? 0) +
    (estimateCostUsd("gpt-5.4", { input: 100, output: 10, cacheRead: 0, cacheCreate: 0 }) ?? 0);
  assert.equal(session.costUsd, expectedCost);
});

test("codex event_msg user_message feeds preview, title, and sentiment signals", () => {
  // Real rollouts carry user text as event_msg/user_message (verified against
  // ~/.codex/sessions); the parser must not depend on top-level user_msg
  // records, which never occur in real files.
  const file = writeSession([
    { timestamp: "2026-06-29T00:00:00.000Z", type: "session_meta", payload: { id: "ev-user", cwd: "/tmp/x" } },
    {
      timestamp: "2026-06-29T00:00:01.000Z",
      type: "event_msg",
      payload: { type: "user_message", message: "Fix the flaky dropdown test in CI" },
    },
    {
      timestamp: "2026-06-29T00:01:00.000Z",
      type: "event_msg",
      payload: { type: "user_message", message: "no, that's wrong — it still fails" },
    },
  ]);
  const session = summarizeCodexSessionFile(file, "2026/06/29", Date.parse("2026-06-29T00:00:00.000Z"));
  assert.ok(session);
  assert.equal(session.displayTitle, "Fix the flaky dropdown test in CI");
  assert.equal(session.lastPromptPreview, "no, that's wrong — it still fails");
  assert.equal(session.outcomeSignals.userNegative, 1);
  assert.equal(session.outcomeSignals.rephrases, 1);
});

test("codex event_msg user_message strips the IDE-context wrapper", () => {
  const wrapped =
    "# Context from my IDE setup:\n\n## Active file: AGENTS.md\n\n## Open tabs:\n- agents.md\n\n## My request for Codex:\nBuild the eval dashboard page";
  const file = writeSession([
    { timestamp: "2026-06-29T00:00:00.000Z", type: "session_meta", payload: { id: "ide-wrap", cwd: "/tmp/x" } },
    { timestamp: "2026-06-29T00:00:01.000Z", type: "event_msg", payload: { type: "user_message", message: wrapped } },
  ]);
  const session = summarizeCodexSessionFile(file, "2026/06/29", Date.parse("2026-06-29T00:00:00.000Z"));
  assert.ok(session);
  assert.equal(session.displayTitle, "Build the eval dashboard page");
  assert.equal(session.lastPromptPreview, "Build the eval dashboard page");
});

test("legacy codex user_msg uses the same wrapper stripping and judge filtering", () => {
  const wrapped = "# Context from my IDE setup:\n\n## Active file: app/page.tsx\n\n## My request for Codex:\nFix the page";
  const file = writeSession([
    { timestamp: "2026-06-29T00:00:00.000Z", type: "session_meta", payload: { id: "legacy-user", cwd: "/repo" } },
    { timestamp: "2026-06-29T00:00:01.000Z", type: "user_msg", payload: { message: wrapped } },
  ]);
  const parsed = summarizeCodexSessionFile(file, "2026/06/29", Date.parse("2026-06-29T00:00:00.000Z"));
  assert.equal(parsed?.lastPromptPreview, "Fix the page");

  const judgeFile = writeSession([
    { timestamp: "2026-06-29T00:00:00.000Z", type: "session_meta", payload: { id: "legacy-judge", cwd: "/repo" } },
    { timestamp: "2026-06-29T00:00:01.000Z", type: "user_msg", payload: { message: `${JUDGE_PROMPT_MARKER} met the goal` } },
  ]);
  const judge = summarizeCodexSessionFile(judgeFile, "2026/06/29", Date.parse("2026-06-29T00:00:00.000Z"));
  assert.equal(judge, null);
});

test("codex sessions opened by the judge marker are dropped", () => {
  const file = writeSession([
    { timestamp: "2026-06-29T00:00:00.000Z", type: "session_meta", payload: { id: "judge-stub", cwd: "/tmp/x" } },
    {
      timestamp: "2026-06-29T00:00:01.000Z",
      type: "event_msg",
      payload: { type: "user_message", message: `${JUDGE_PROMPT_MARKER} went well. Transcript follows.` },
    },
  ]);
  const session = summarizeCodexSessionFile(file, "2026/06/29", Date.parse("2026-06-29T00:00:00.000Z"));
  assert.equal(session, null);
});

test("codex tool errors are grounded in exit-code markers, sniffing only without one", () => {
  const call = (t: string, id: string) => ({
    timestamp: t,
    type: "response_item",
    payload: { type: "function_call", call_id: id, name: "exec_command", arguments: "{}" },
  });
  const output = (t: string, id: string, out: string) => ({
    timestamp: t,
    type: "response_item",
    payload: { type: "function_call_output", call_id: id, output: out },
  });
  const file = writeSession([
    { timestamp: "2026-06-29T00:00:00.000Z", type: "session_meta", payload: { id: "exit-codes", cwd: "/tmp/x" } },
    call("2026-06-29T00:00:01.000Z", "c1"),
    // Exit 0 that merely MENTIONS "error:" must not be flagged.
    output("2026-06-29T00:00:02.000Z", "c1", "Exit code: 0\nWall time: 0.3 seconds\nOutput:\nerror: handling docs updated"),
    call("2026-06-29T00:00:03.000Z", "c2"),
    // JSON envelope with structured exit_code (the dominant real shape).
    output("2026-06-29T00:00:04.000Z", "c2", JSON.stringify({ output: "boom", metadata: { exit_code: 2, duration_seconds: 0.1 } })),
    call("2026-06-29T00:00:05.000Z", "c3"),
    // No marker at all → fall back to the text heuristic.
    output("2026-06-29T00:00:06.000Z", "c3", "zsh: command not found: florp"),
  ]);
  const session = summarizeCodexSessionFile(file, "2026/06/29", Date.parse("2026-06-29T00:00:00.000Z"));
  assert.ok(session);
  assert.equal(session.toolCalls, 3);
  assert.equal(session.toolErrors, 2);
});

test("codex usageSegments are downsampled to a bounded count", () => {
  const base = Date.parse("2026-06-29T00:00:00.000Z");
  const lines: unknown[] = [
    { timestamp: "2026-06-29T00:00:00.000Z", type: "session_meta", payload: { id: "segments", model: "gpt-5.5" } },
  ];
  const total = 1100;
  for (let i = 1; i <= total; i++) {
    lines.push({
      timestamp: new Date(base + i * 1000).toISOString(),
      type: "event_msg",
      payload: { type: "token_count", info: {
        total_token_usage: { input_tokens: i * 10, cached_input_tokens: 0, output_tokens: i * 2 },
      } },
    });
  }
  const session = summarizeCodexSessionFile(writeSession(lines), "2026/06/29", base);
  assert.ok(session);
  // 1100 → 550 → 275 (halved until ≤ 500); the curve's endpoints and delta
  // sums survive the merge.
  assert.equal(session.usageSegments.length, 275);
  assert.equal(session.usageSegments[session.usageSegments.length - 1].cumulativeOutput, total * 2);
  assert.equal(session.usageSegments.reduce((sum, s) => sum + s.deltaOutput, 0), total * 2);
});

test("claude interactive sessions infer duration and turns from record timestamps", () => {
  const file = writeSession([
    { type: "user", timestamp: "2026-06-28T20:00:00.000Z", message: { content: "Fix the login bug" } },
    { type: "assistant", timestamp: "2026-06-28T20:00:05.000Z", message: { content: [{ type: "text", text: "Looking." }] } },
    // Tool results and sidechain prompts are not user turns.
    { type: "user", timestamp: "2026-06-28T20:05:00.000Z", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } },
    { type: "user", timestamp: "2026-06-28T20:06:00.000Z", isSidechain: true, message: { content: "subagent brief" } },
    { type: "user", timestamp: "2026-06-28T20:10:00.000Z", message: { content: "now add a regression test for it" } },
    { type: "assistant", timestamp: "2026-06-28T20:10:30.000Z", message: { content: [{ type: "text", text: "Done." }] } },
  ]);
  const session = summarizeLiveSessionFile(file, "-Users-ralto-Documents-AgentEvals", Date.parse("2026-06-28T20:10:30.000Z"));
  assert.ok(session);
  assert.equal(session.durationMs, 630_000);
  assert.equal(session.metricSources.duration, "inferred");
  assert.equal(session.numTurns, 2);
  assert.equal(session.metricSources.turns, "inferred");
});

test("codex titles and prompt previews skip injected persona preambles", () => {
  const preamble =
    "You are Worker 3 for the StorageScope UX fixes. You are one of several agents working in parallel on this repository; coordinate via the shared task list and never push without review.";
  const file = writeSession([
    { timestamp: "2026-06-29T00:00:00.000Z", type: "session_meta", payload: { id: "subagent", cwd: "/tmp/x", source: { subagent: { thread_spawn: { agent_nickname: "Worker 3" } } } } },
    {
      timestamp: "2026-06-29T00:00:01.000Z",
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: preamble }] },
    },
    { timestamp: "2026-06-29T00:00:01.500Z", type: "user_msg", payload: { message: preamble } },
    {
      timestamp: "2026-06-29T00:00:02.000Z",
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Fix the flaky dropdown test" }] },
    },
  ]);
  const session = summarizeCodexSessionFile(file, "2026/06/29", Date.parse("2026-06-29T00:00:00.000Z"));
  assert.ok(session);
  assert.equal(session.displayTitle, "Fix the flaky dropdown test");
  // The real response_item user record is now used when the legacy user_msg
  // stream contains only the injected preamble.
  assert.equal(session.lastPromptPreview, "Fix the flaky dropdown test");
});

test("coordinator-root preambles are suppressed without a subagent flag", () => {
  const preamble =
    "You are `/root`, the primary agent in a team of agents collaborating to fulfill the user's request. Spawn workers via the task tool and coordinate their output before replying.";
  const file = writeSession([
    { timestamp: "2026-06-29T00:00:00.000Z", type: "session_meta", payload: { id: "root", cwd: "/tmp/x", source: "vscode" } },
    {
      timestamp: "2026-06-29T00:00:01.000Z",
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: preamble }] },
    },
  ]);
  const session = summarizeCodexSessionFile(file, "2026/06/29", Date.parse("2026-06-29T00:00:00.000Z"));
  assert.ok(session);
  assert.equal(session.displayTitle, null);
});

test("a human's long 'You are …' prompt keeps its title in non-subagent sessions", () => {
  const prompt =
    "You are too verbose lately, please rewrite the following function to be terse and defensive, keeping the public contract identical while trimming every incidental comment.";
  const file = writeSession([
    { timestamp: "2026-06-29T00:00:00.000Z", type: "session_meta", payload: { id: "normal", cwd: "/tmp/x" } },
    {
      timestamp: "2026-06-29T00:00:01.000Z",
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: prompt }] },
    },
  ]);
  const session = summarizeCodexSessionFile(file, "2026/06/29", Date.parse("2026-06-29T00:00:00.000Z"));
  assert.ok(session);
  assert.ok(session.displayTitle?.startsWith("You are too verbose"));
});

test("summarizeCodexSessionFile reads Codex App and CLI rollout usage", () => {
  const file = writeSession([
    {
      timestamp: "2026-06-29T00:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "codex-session",
        cwd: "/Users/ralto/Documents/AgentEvals",
        originator: "Codex Desktop",
        source: "vscode",
        cli_version: "0.142.3",
        model_provider: "openai",
      },
    },
    {
      timestamp: "2026-06-29T00:00:02.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        call_id: "call-1",
        name: "exec_command",
        arguments: "{\"cmd\":\"sed -n '1,20p' /Users/ralto/Documents/AgentEvals/lib/live.ts\"}",
      },
    },
    {
      timestamp: "2026-06-29T00:00:03.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-1",
        output: "Exit code: 0\n/Users/ralto/Documents/AgentEvals/lib/live.ts",
      },
    },
    {
      timestamp: "2026-06-29T00:00:04.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          // Real Codex format: input_tokens INCLUDES the cached portion and
          // total_tokens = input + output (verified against ~/.codex/sessions).
          total_token_usage: {
            input_tokens: 1000,
            cached_input_tokens: 250,
            output_tokens: 120,
            reasoning_output_tokens: 30,
            total_tokens: 1120,
          },
        },
      },
    },
  ]);

  const session = summarizeCodexSessionFile(file, "2026/06/29", Date.parse("2026-06-29T00:00:00.000Z"));

  assert.ok(session);
  assert.equal(session.sessionId, "codex-session");
  assert.equal(session.project, "/Users/ralto/Documents/AgentEvals");
  assert.equal(session.userType, "Codex Desktop");
  assert.equal(session.modeSummary.entrypoint, "vscode");
  assert.equal(session.metricSources.tokens, "measured");
  // input_tokens (1000) includes the 250 cached; report fresh (750) + cacheRead
  // (250) as disjoint buckets so they don't double-count. total = input + output.
  assert.equal(session.inputTokens, 750);
  assert.equal(session.outputTokens, 120);
  assert.equal(session.cacheReadTokens, 250);
  assert.equal(session.totalTokens, 1120);
  assert.equal(session.cacheCreateTokens, 0);
  assert.equal(session.toolCalls, 1);
  assert.ok(session.fileActivity.touchedFiles.includes("/Users/ralto/Documents/AgentEvals/lib/live.ts"));
  assert.equal(session.usageSegments.length, 1);
  assert.equal(session.toolDurations.length, 1);
  const execDur = session.toolDurations[0];
  assert.equal(execDur.name, "exec_command");
  assert.equal(execDur.count, 1);
  assert.equal(execDur.p50Ms, 1000);
  assert.equal(execDur.maxMs, 1000);
  assert.equal(execDur.errors, 0);
});

test("scanLiveSessions reports unsupported harnesses honestly", () => {
  const data = scanLiveSessions(10, "unknown-live-harness");
  assert.equal(data.sourceHarness, "unknown-live-harness");
  assert.equal(data.sourceStatus, "unavailable");
  assert.equal(data.totalSessions, 0);
  assert.equal(data.usageSummary.totalTokens, 0);
  assert.ok(data.scanWarnings.some((warning) => warning.includes("does not have a registered live trace source")));
});

test("live API accepts harness query and unknown harnesses", async () => {
  const ncodeResponse = await liveGet(new Request("http://localhost/api/live?harness=ncode&limit=1"));
  assert.equal(ncodeResponse.status, 200);
  const ncodeData = await ncodeResponse.json();
  assert.equal(ncodeData.sourceHarness, "ncode");
  assert.equal(ncodeData.sourceStatus, "available");
  assert.ok(ncodeData.totalSessions <= 1);

  const codexResponse = await liveGet(new Request("http://localhost/api/live?harness=codex&limit=1"));
  assert.equal(codexResponse.status, 200);
  const codexData = await codexResponse.json();
  assert.equal(codexData.sourceHarness, "codex");
  assert.equal(codexData.sourceStatus, "available");
  assert.ok(codexData.totalSessions <= 1);
});

test("live API sig shortcut returns a tiny unchanged payload on match and the full payload otherwise", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-live-sig-"));
  const descPath = path.join(HARNESS_DESC_DIR, `tmp-live-sig-${Date.now()}.harness.json`);
  fs.mkdirSync(HARNESS_DESC_DIR, { recursive: true });
  const sessionLine = (id: string) => JSON.stringify({
    type: "done",
    session_id: id,
    model: "sig-model",
    duration_ms: 1000,
    num_turns: 2,
    usage: { input_tokens: 10, output_tokens: 5 },
    stop_reason: "completed",
    is_error: false,
  });
  fs.writeFileSync(path.join(root, "session-a.jsonl"), sessionLine("sig-session-a"), "utf8");
  fs.writeFileSync(descPath, JSON.stringify({
    id: "tmp-live-sig-source",
    label: "Temporary Sig Source",
    binNames: ["tmp-live-sig-source"],
    output: "jsonl",
    argTemplate: ["run"],
    fields: {
      sessionId: "session_id",
      model: "model",
      durationMs: "duration_ms",
      numTurns: "num_turns",
      inputTokens: "usage.input_tokens",
      outputTokens: "usage.output_tokens",
      stopReason: "stop_reason",
      isError: "is_error",
    },
    liveTrace: { roots: [root], maxDepth: 1 },
  }), "utf8");

  try {
    const base = "http://localhost/api/live?harness=tmp-live-sig-source&limit=10";
    const fullResponse = await liveGet(new Request(base));
    assert.equal(fullResponse.status, 200);
    const fullData = await fullResponse.json();
    assert.equal(fullData.sourceStatus, "available");
    assert.equal(fullData.totalSessions, 1);
    assert.equal(typeof fullData.sig, "string");
    assert.ok(fullData.sig.length >= 8);
    assert.equal(typeof fullData.generatedAt, "number");
    assert.notEqual(fullData.unchanged, true);

    // Matching sig → tiny unchanged response, no sessions payload.
    const unchangedResponse = await liveGet(new Request(`${base}&sig=${fullData.sig}`));
    assert.equal(unchangedResponse.status, 200);
    const unchangedData = await unchangedResponse.json();
    assert.equal(unchangedData.unchanged, true);
    assert.equal(unchangedData.sig, fullData.sig);
    assert.equal(unchangedData.sessions, undefined);
    assert.equal(unchangedData.totalSessions, undefined);

    // Mismatched sig → full backward-compatible payload with a sig attached.
    const mismatchResponse = await liveGet(new Request(`${base}&sig=bogus`));
    assert.equal(mismatchResponse.status, 200);
    const mismatchData = await mismatchResponse.json();
    assert.notEqual(mismatchData.unchanged, true);
    assert.equal(mismatchData.totalSessions, 1);
    assert.ok(Array.isArray(mismatchData.sessions));
    assert.equal(mismatchData.sig, fullData.sig);

    // Content change → old sig no longer matches; full payload with new sig.
    fs.writeFileSync(path.join(root, "session-b.jsonl"), sessionLine("sig-session-b"), "utf8");
    const changedResponse = await liveGet(new Request(`${base}&sig=${fullData.sig}`));
    assert.equal(changedResponse.status, 200);
    const changedData = await changedResponse.json();
    assert.notEqual(changedData.unchanged, true);
    assert.equal(changedData.totalSessions, 2);
    assert.notEqual(changedData.sig, fullData.sig);
  } finally {
    fs.rmSync(descPath, { force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("summarizeLiveSessionFile infers Noumena Code ncode model without pretending it is measured", () => {
  const file = writeSession([
    {
      type: "system",
      sessionId: "noumena-session",
      cwd: "/Users/ralto/Documents/AgentEvals",
      userType: "noumena",
      timestamp: "2026-06-28T20:00:00.000Z",
    },
  ]);

  const session = summarizeLiveSessionFile(file, "-Users-ralto-Documents-AgentEvals", Date.parse("2026-06-28T20:01:00.000Z"), { inferredModel: "GLM 5.2 (1M)" });

  assert.ok(session);
  assert.equal(session.model, "GLM 5.2 (1M)");
  assert.equal(session.metricSources.model, "inferred");
  assert.ok(session.parseWarnings.some((warning) => warning.includes("model inferred as GLM 5.2")));
  assert.ok(!session.parseWarnings.some((warning) => warning === "model missing from trace"));
});

test("summarizeLiveSessionFile extracts trace intelligence from graph, tools, queue, files, and modes", () => {
  const file = writeSession([
    {
      type: "custom-title",
      customTitle: "repair-live-dashboard",
      sessionId: "trace-intel",
    },
    {
      type: "agent-name",
      agentName: "repair-live-dashboard",
      sessionId: "trace-intel",
    },
    {
      type: "last-prompt",
      lastPrompt: "please fix /Users/ralto/private-app and inspect logs",
      sessionId: "trace-intel",
    },
    {
      type: "system",
      sessionId: "trace-intel",
      cwd: "/Users/ralto/Documents/AgentEvals",
      gitBranch: "codex/live-intel",
      userType: "noumena",
      entrypoint: "cli",
      permissionMode: "bypassPermissions",
      timestamp: "2026-06-28T20:00:00.000Z",
    },
    {
      type: "assistant",
      sessionId: "trace-intel",
      uuid: "assistant-1",
      isSidechain: true,
      agentId: "agent-a1",
      userType: "noumena",
      entrypoint: "cli",
      cwd: "/Users/ralto/Documents/AgentEvals",
      gitBranch: "codex/live-intel",
      permissionMode: "acceptEdits",
      timestamp: "2026-06-28T20:00:10.000Z",
      message: {
        content: [
          { type: "tool_use", id: "tool-bash", name: "Bash", input: { command: "npm test" } },
          { type: "tool_use", id: "tool-edit", name: "Edit", input: { file_path: "/Users/ralto/Documents/AgentEvals/lib/live.ts" } },
        ],
      },
    },
    {
      type: "user",
      sessionId: "trace-intel",
      uuid: "user-2",
      parentUuid: "assistant-1",
      isSidechain: false,
      userType: "noumena",
      entrypoint: "cli",
      cwd: "/Users/ralto/Documents/AgentEvals",
      gitBranch: "codex/live-intel",
      permissionMode: "bypassPermissions",
      timestamp: "2026-06-28T20:00:20.000Z",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "tool-bash", content: "Exit code 1\nboom", is_error: true },
          { type: "tool_result", tool_use_id: "tool-edit", content: "ok", is_error: false },
        ],
      },
    },
    {
      type: "queue-operation",
      operation: "enqueue",
      content: "new direction: check /home/ralto/secrets",
      timestamp: "2026-06-28T20:00:30.000Z",
      sessionId: "trace-intel",
    },
    {
      type: "attachment",
      attachment: { type: "edited_text_file", filePath: "/Users/ralto/Documents/AgentEvals/components/LiveClient.tsx" },
      timestamp: "2026-06-28T20:00:40.000Z",
      sessionId: "trace-intel",
    },
    {
      type: "file-history-snapshot",
      messageId: "m1",
      isSnapshotUpdate: false,
      snapshot: { trackedFileBackups: { "/Users/ralto/Documents/AgentEvals/lib/live.ts": "backup" } },
    },
  ]);

  const session = summarizeLiveSessionFile(file, "-Users-ralto-Documents-AgentEvals", Date.parse("2026-06-28T20:01:00.000Z"));

  assert.ok(session);
  assert.equal(session.displayTitle, "repair-live-dashboard");
  assert.equal(session.lastPromptPreview, "please fix /Users/ralto/private-app and inspect logs");
  assert.equal(session.traceGraph.sidechainMessages, 1);
  assert.equal(session.traceGraph.rootMessages, 1);
  assert.equal(session.traceGraph.agentCount, 1);
  assert.equal(session.traceGraph.orphanMessages, 0);
  assert.equal(session.modeSummary.permissionModes.bypassPermissions, 2);
  assert.equal(session.modeSummary.permissionModes.acceptEdits, 1);
  assert.equal(session.modeSummary.gitBranch, "codex/live-intel");
  assert.equal(session.toolSummaries.find((tool) => tool.name === "Bash")?.errors, 1);
  assert.equal(session.toolSummaries.find((tool) => tool.name === "Edit")?.calls, 1);
  assert.equal(session.queueSummary.enqueue, 1);
  assert.equal(session.queueSummary.preview[0], "new direction: check /home/ralto/secrets");
  assert.ok(session.fileActivity.touchedFiles.includes("/Users/ralto/Documents/AgentEvals/lib/live.ts"));
  assert.ok(session.fileActivity.touchedFiles.includes("/Users/ralto/Documents/AgentEvals/components/LiveClient.tsx"));
  assert.equal(session.fileActivity.writeLikeOperations, 2);
});

test("redactSensitiveText hides local usernames while preserving useful suffixes", () => {
  assert.equal(
    redactSensitiveText("/Users/ralto/Documents/AgentEvals/data/session.jsonl"),
    "/Users/[redacted]/Documents/AgentEvals/data/session.jsonl",
  );
  assert.equal(
    redactSensitiveText("/home/ralto/projects/openeval/session.jsonl"),
    "/home/[redacted]/projects/openeval/session.jsonl",
  );
  assert.equal(
    redactSensitiveText("/Users/ralto/.ncode/projects/-Users-ralto-Documents-AgentEvals/session.jsonl"),
    "/Users/[redacted]/.ncode/projects/-Users-[redacted]-Documents-AgentEvals/session.jsonl",
  );
  assert.equal(redactSensitiveText("relative/project"), "relative/project");
  assert.equal(compactDisplayPath("/Users/ralto/Documents/AgentEvals", true), "~/Documents/AgentEvals");
  assert.equal(compactDisplayPath("/Users/ralto/Documents/AgentEvals", false), "/Users/ralto/Documents/AgentEvals");
  assert.equal(compactDisplayPath("/Users/ralto/.ncode", true), "~/.ncode");
});
