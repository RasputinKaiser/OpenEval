import test, { after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _setCacheDbForTest } from "../lib/live-cache";
import { aggregate } from "../lib/live/aggregate";
import { scanSourceSessions, summarizeLiveSessionFile } from "../lib/live";
import type { LiveSession } from "../lib/live";

const cacheConn = new Database(":memory:");
_setCacheDbForTest(cacheConn);
after(() => {
  _setCacheDbForTest(null);
  cacheConn.close();
});

function writeJsonl(file: string, records: unknown[], mtimeMs?: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, records.map((record) => JSON.stringify(record)).join("\n"), "utf8");
  if (mtimeMs != null) fs.utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
}

function sessionRecords(id: string, text: string, at: string): unknown[] {
  return [
    { type: "user", timestamp: at, sessionId: id, message: { content: text } },
    { type: "assistant", timestamp: at, sessionId: id, message: { model: "claude-fidelity-5", content: [{ type: "text", text: "done" }], usage: { input_tokens: 10, output_tokens: 2 } } },
  ];
}

test("scan coverage deduplicates session identities with a deterministic winner", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-corpus-duplicate-"));
  const oldFile = path.join(root, "a-old.jsonl");
  const newFile = path.join(root, "z-new.jsonl");
  const base = Date.parse("2026-07-20T00:00:00.000Z");
  try {
    writeJsonl(oldFile, sessionRecords("same-session", "old copy", "2026-07-20T00:00:00.000Z"), base);
    writeJsonl(newFile, sessionRecords("same-session", "new copy", "2026-07-20T00:00:01.000Z"), base + 1000);
    const spec = { id: "duplicate-fixture", label: "Duplicate fixture", roots: [root], format: "jsonl-dir" as const, maxDepth: 1 };

    const first = scanSourceSessions(spec, 10);
    const second = scanSourceSessions(spec, 10);
    assert.equal(first.totalSessions, 1);
    assert.equal(first.scanCoverage.discoveredFiles, 2);
    assert.equal(first.scanCoverage.scannedFiles, 2);
    assert.equal(first.scanCoverage.parsedFiles, 1);
    assert.equal(first.scanCoverage.droppedFiles, 1);
    assert.equal(first.scanCoverage.partial, false, "known duplicates are complete coverage, not an unknown gap");
    assert.ok(first.scanWarnings.some((warning) => warning.includes("shared an existing session id")));
    assert.equal(first.sessions[0]?.path, newFile, "newest duplicate wins deterministically");
    assert.deepEqual(
      { coverage: second.scanCoverage, warnings: second.scanWarnings, path: second.sessions[0]?.path },
      { coverage: first.scanCoverage, warnings: first.scanWarnings, path: first.sessions[0]?.path },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("depth-capped discovery keeps an explicit unknown boundary", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-corpus-depth-"));
  const hidden = path.join(root, "one", "two", "hidden.jsonl");
  try {
    writeJsonl(hidden, sessionRecords("hidden-session", "below the cap", "2026-07-20T00:00:00.000Z"));
    const data = scanSourceSessions({ id: "depth-fixture", label: "Depth fixture", roots: [root], format: "jsonl-dir", maxDepth: 1 }, 10);
    assert.equal(data.totalSessions, 0);
    assert.deepEqual(data.scanCoverage, {
      requestedLimit: 10,
      discoveredFiles: 0,
      scannedFiles: 0,
      parsedFiles: 0,
      droppedFiles: 0,
      unscannedFiles: 0,
      archivedSessionsAdded: 0,
      truncated: false,
      partial: true,
    });
    assert.ok(data.scanWarnings.some((warning) => warning.includes("Scan depth boundary") && warning.includes("matching transcript files may exist")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("archived summaries retain child lineage without copying raw transcript bodies", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-corpus-archive-"));
  const project = path.join(root, "project");
  const parentFile = path.join(project, "parent.jsonl");
  const childFile = path.join(project, "parent", "subagents", "agent-child.jsonl");
  const rawMarker = "raw transcript body that must not be retained in the compact archive";
  try {
    writeJsonl(parentFile, sessionRecords("parent", `${"x".repeat(400)}${rawMarker}`, "2026-07-20T00:00:00.000Z"));
    writeJsonl(childFile, [
      { type: "user", timestamp: "2026-07-20T00:00:02.000Z", sessionId: "parent", uuid: "child-user", parentUuid: null, isSidechain: true, agentId: "child", cwd: "/tmp/child", message: { content: "inspect the child work" } },
      { type: "assistant", timestamp: "2026-07-20T00:00:03.000Z", sessionId: "parent", uuid: "child-assistant", parentUuid: "child-user", isSidechain: true, agentId: "child", cwd: "/tmp/child", message: { model: "claude-fidelity-5", content: [{ type: "text", text: "child done" }], usage: { input_tokens: 8, output_tokens: 2 } } },
    ]);
    const spec = { id: "archive-fixture", label: "Archive fixture", roots: [root], format: "claude-projects" as const };
    const live = scanSourceSessions(spec, 10, { includeArchived: true, sessionRetention: 10 });
    assert.equal(live.totalSessions, 2);
    assert.equal(live.subagentSessions, 1);

    fs.rmSync(root, { recursive: true, force: true });
    const archived = scanSourceSessions(spec, 10, { includeArchived: true, sessionRetention: 10 });
    assert.equal(archived.totalSessions, 2);
    assert.equal(archived.archivedSessions, 2);
    const child = archived.sessions.find((session) => session.agentLabel === "agent-child");
    assert.equal(child?.isSubagent, true);
    assert.equal(child?.parentSessionId, "parent");
    assert.equal(child?.sessionId, "parent/agent-child");

    const rows = cacheConn.prepare("SELECT session_json FROM session_cache").all() as Array<{ session_json: string | null }>;
    assert.ok(rows.length >= 2);
    assert.ok(rows.every((row) => !row.session_json?.includes(rawMarker)), "archive stores parsed summaries, not raw transcript bodies");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function aggregateSession(id: string, model: string): LiveSession {
  return {
    sessionId: id,
    displayTitle: null,
    lastPromptPreview: null,
    project: "/tmp/fidelity",
    model,
    startedAt: 1,
    lastEventAt: 1,
    durationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    usageSegments: [],
    toolCalls: 0,
    toolErrors: 0,
    numTurns: 0,
    stopReason: null,
    isError: false,
    pathBytes: 0,
    lineCount: 0,
    malformedLineCount: 0,
    thinkingBlocks: 0,
    textBlocks: 0,
    attachmentCount: 0,
    queueOperationCount: 0,
    snapshotCount: 0,
    hookErrors: 0,
    messageCount: 0,
    userType: null,
    dataQuality: 100,
    metricSources: { model: "measured", tokens: "missing", cost: "missing", duration: "missing", turns: "missing" },
    parseWarnings: [],
    toolErrorRate: 0,
    toolCallsPerTurn: 0,
    textAvailability: 0,
    staleMs: 0,
    traceGraph: { rootMessages: 0, sidechainMessages: 0, agentCount: 0, orphanMessages: 0 },
    toolSummaries: [],
    toolDurations: [],
    queueSummary: { enqueue: 0, dequeue: 0, remove: 0, popAll: 0, preview: [] },
    fileActivity: { touchedFiles: [], readLikeOperations: 0, writeLikeOperations: 0 },
    modeSummary: { permissionModes: {}, gitBranch: null, entrypoint: null },
    skillsUsed: [],
    mcpServersUsed: [],
    subagentSpawns: 0,
    cliVersion: null,
    outcomeSignals: { userPositive: 0, userNegative: 0, rephrases: 0, errorTail: false, testsPassedTail: false, reworkFiles: 0 },
  };
}

test("aggregate model rollups use a stable tie-break independent of input order", () => {
  const data = aggregate([aggregateSession("z", "z-model"), aggregateSession("a", "a-model")]);
  assert.deepEqual(data.byModel.map((row) => row.model), ["a-model", "z-model"]);
});

test("large JSONL summaries remain readable through the streaming path", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-corpus-stream-"));
  const file = path.join(root, "large.jsonl");
  try {
    const records: unknown[] = Array.from({ length: 20_000 }, (_, index) => ({ type: "tool", index, text: "bounded streaming fixture" }));
    records.unshift(...sessionRecords("large-session", "stream this corpus", "2026-07-20T00:00:00.000Z"));
    writeJsonl(file, records);
    const session = summarizeLiveSessionFile(file, root, Date.parse("2026-07-20T00:00:00.000Z"));
    assert.equal(session?.sessionId, "large-session");
    assert.equal(session?.lineCount, records.length);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
