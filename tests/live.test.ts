import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  compactDisplayPath,
  isPathInLiveSource,
  redactSensitiveText,
  scanLiveSessions,
  summarizeCodexSessionFile,
  summarizeLiveSessionFile,
} from "../lib/live";
import { HARNESS_DESC_DIR } from "../lib/config";
import { GET as liveGet } from "../app/api/live/route";

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
  assert.equal(first, second, "expected the cache to return the same object reference for an unchanged file");
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
          total_token_usage: {
            input_tokens: 1000,
            cached_input_tokens: 250,
            output_tokens: 120,
            reasoning_output_tokens: 30,
            total_tokens: 1370,
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
  assert.equal(session.inputTokens, 1000);
  assert.equal(session.outputTokens, 120);
  assert.equal(session.cacheReadTokens, 250);
  assert.equal(session.totalTokens, 1370);
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

  const session = summarizeLiveSessionFile(file, "-Users-ralto-Documents-AgentEvals", Date.parse("2026-06-28T20:01:00.000Z"));

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
