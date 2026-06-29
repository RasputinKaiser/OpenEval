import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  compactDisplayPath,
  redactSensitiveText,
  summarizeLiveSessionFile,
} from "../lib/live";

function writeSession(lines: unknown[], extras: string[] = []): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neval-live-"));
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
  assert.ok(session.parseWarnings.some((warning) => warning.includes("malformed")));
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
    redactSensitiveText("/home/ralto/projects/neval/session.jsonl"),
    "/home/[redacted]/projects/neval/session.jsonl",
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
