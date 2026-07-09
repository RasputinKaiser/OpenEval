import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractJudgeDigest, buildJudgePrompt, selectJudgeSample, markerWindowSample, openRouterContent } from "../lib/insights/judge";
import { toPoints, detectMarkers, markerImpact } from "../lib/insights/timeline";
import type { LiveSession, OutcomeSignals } from "../lib/live";
import type { StoredJudgment } from "../lib/live-cache";

function session(over: Partial<LiveSession> & { startedAt: number }): LiveSession & { sourceLabel: string } {
  const sig: OutcomeSignals = { userPositive: 0, userNegative: 0, rephrases: 0, errorTail: false, testsPassedTail: false, reworkFiles: 0 };
  return {
    sessionId: "s" + over.startedAt, displayTitle: null, lastPromptPreview: null, project: "/p", model: "claude-opus-4-8",
    lastEventAt: over.startedAt, durationMs: 60000,
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, totalTokens: 0, costUsd: 0,
    usageSegments: [], toolCalls: 0, toolErrors: 0, numTurns: 1, stopReason: null, isError: false,
    pathBytes: 0, lineCount: 0, malformedLineCount: 0, thinkingBlocks: 0, textBlocks: 0, attachmentCount: 0,
    queueOperationCount: 0, snapshotCount: 0, hookErrors: 0, messageCount: 1, userType: null, dataQuality: 1,
    metricSources: { model: "measured", tokens: "measured", cost: "inferred", duration: "measured", turns: "measured" },
    parseWarnings: [], toolErrorRate: 0, toolCallsPerTurn: 0, textAvailability: 0, staleMs: 0,
    traceGraph: { rootMessages: 0, sidechainMessages: 0, agentCount: 0, orphanMessages: 0 },
    toolSummaries: [], toolDurations: [], queueSummary: { enqueue: 0, dequeue: 0, remove: 0, popAll: 0, preview: [] },
    fileActivity: { touchedFiles: [], readLikeOperations: 0, writeLikeOperations: 0 },
    modeSummary: { permissionModes: {}, gitBranch: null, entrypoint: null },
    skillsUsed: [], mcpServersUsed: [], subagentSpawns: 0, cliVersion: null,
    sourceLabel: "Claude Code",
    path: "/sessions/s" + over.startedAt + ".jsonl",
    ...over,
    outcomeSignals: { ...sig, ...(over.outcomeSignals ?? {}) },
  };
}

function writeTmp(lines: unknown[]): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "judge-test-")), "t.jsonl");
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n"));
  return file;
}

test("extractJudgeDigest pulls the conversational spine from a Claude-shaped transcript", () => {
  const file = writeTmp([
    { type: "user", message: { role: "user", content: "Fix the login bug please" } },
    { type: "assistant", message: { content: [{ type: "text", text: "Looking at auth.ts now." }] } },
    { type: "user", message: { content: [{ type: "tool_result", content: "exit 0" }] } }, // tool result, not user text
    { type: "user", message: { content: [{ type: "text", text: "that broke signup, revert it" }] } },
    { type: "assistant", message: { content: [{ type: "text", text: "Reverted and fixed both paths." }] } },
  ]);
  const d = extractJudgeDigest(file);
  assert.equal(d.firstUser, "Fix the login bug please");
  assert.deepEqual(d.laterUsers, ["that broke signup, revert it"]);
  assert.equal(d.lastAssistant, "Reverted and fixed both paths.");
});

test("extractJudgeDigest understands Codex event_msg payloads", () => {
  const file = writeTmp([
    { type: "event_msg", payload: { type: "user_message", message: "add a retry to the fetch" } },
    { type: "event_msg", payload: { type: "agent_message", message: "Added exponential backoff." } },
    { type: "event_msg", payload: { type: "token_count", info: {} } },
  ]);
  const d = extractJudgeDigest(file);
  assert.equal(d.firstUser, "add a retry to the fetch");
  assert.equal(d.lastAssistant, "Added exponential backoff.");
});

test("buildJudgePrompt embeds the digest and demands bare JSON", () => {
  const p = buildJudgePrompt(
    { firstUser: "do X", laterUsers: ["no, do Y"], lastAssistant: "done Y" },
    { durationMin: 12, toolErrorRate: 0.25 },
  );
  assert.ok(p.includes('{"score"'));
  assert.ok(p.includes("do X"));
  assert.ok(p.includes("no, do Y"));
  assert.ok(p.includes("done Y"));
  assert.ok(p.includes("25%"));
});

test("selectJudgeSample prioritizes sessions around markers, skips judged, respects max", () => {
  const sessions = [];
  for (let t = 1; t <= 30; t++) {
    sessions.push(session({ startedAt: t * 1000, skillsUsed: t >= 15 ? ["tdd"] : [] }));
  }
  const points = toPoints(sessions);
  const markers = detectMarkers(points).filter((m) => m.kind === "skill");
  assert.equal(markers.length, 1);

  const sample = selectJudgeSample(points, markers, new Set(), 6);
  assert.equal(sample.length, 6);
  // Interleaved around firstSeenAt (t=15): both sides represented.
  assert.ok(sample.some((p) => p.at < 15_000), "expected before-window sessions");
  assert.ok(sample.some((p) => p.at >= 15_000), "expected after-window sessions");

  // Already-judged files are skipped.
  const judgedAll = new Set(points.map((p) => p.path!));
  assert.equal(selectJudgeSample(points, markers, judgedAll, 6).length, 0);
});

test("toPoints prefers persisted judge verdicts over the heuristic", () => {
  const s = session({ startedAt: 1000, outcomeSignals: { userNegative: 2, errorTail: true } as OutcomeSignals });
  const judgments = new Map<string, StoredJudgment>([
    [s.path!, { file: s.path!, sessionId: s.sessionId, mtimeMs: 0, score: 0.9, reasons: ["goal met"], judge: "codex", judgedAt: 1 }],
  ]);
  const [withJudgment] = toPoints([s], judgments);
  assert.equal(withJudgment.outcome, 0.9);
  assert.equal(withJudgment.outcomeProvenance, "judged");
  assert.equal(withJudgment.outcomeHasSignal, true);
  assert.deepEqual(withJudgment.outcomeReasons, ["goal met"]);

  const [heuristic] = toPoints([s]);
  assert.ok(heuristic.outcome < 0.45);
  assert.equal(heuristic.outcomeProvenance, "heuristic");
});

test("markerWindowSample takes full windows, dedupes, and skips judged files", () => {
  const sessions = [];
  for (let t = 1; t <= 60; t++) {
    sessions.push(session({ startedAt: t * 1000, skillsUsed: t >= 30 ? ["tdd"] : [], mcpServersUsed: t >= 32 ? ["ctx7"] : [] }));
  }
  const points = toPoints(sessions);
  const markers = detectMarkers(points).filter((m) => m.kind !== "model");
  const sample = markerWindowSample(points, markers, new Set());
  // Windows overlap heavily (markers 2 sessions apart) — dedupe must hold.
  assert.equal(new Set(sample.map((p) => p.path)).size, sample.length);
  // Both sides of the first marker are covered in full (20 + 20).
  assert.ok(sample.length >= 40, `expected ≥40, got ${sample.length}`);
  // Judged files are excluded.
  const judged = new Set(sample.slice(0, 10).map((p) => p.path!));
  assert.equal(markerWindowSample(points, markers, judged).length, sample.length - 10);
});

test("markerImpact switches to judged-only medians at 5 judged per side", () => {
  const sessions = [];
  for (let t = 1; t <= 40; t++) {
    // Heuristic signal everywhere: mild praise → 0.5+ scores.
    sessions.push(session({ startedAt: t * 1000, skillsUsed: t >= 21 ? ["tdd"] : [], outcomeSignals: { userPositive: 1 } as OutcomeSignals }));
  }
  // Judge 6 sessions on each side of t=21: before scores 0.2, after scores 0.9.
  const judgments = new Map<string, StoredJudgment>();
  for (const t of [15, 16, 17, 18, 19, 20]) {
    judgments.set(`/sessions/s${t * 1000}.jsonl`, { file: "", sessionId: "", mtimeMs: 0, score: 0.2, reasons: [], judge: "codex", judgedAt: 1 });
  }
  for (const t of [21, 22, 23, 24, 25, 26]) {
    judgments.set(`/sessions/s${t * 1000}.jsonl`, { file: "", sessionId: "", mtimeMs: 0, score: 0.9, reasons: [], judge: "codex", judgedAt: 1 });
  }
  const points = toPoints(sessions, judgments);
  const marker = detectMarkers(points).find((m) => m.name === "tdd")!;
  const impact = markerImpact(points, marker, 20, 5);
  assert.equal(impact.judgedBefore, 6);
  assert.equal(impact.judgedAfter, 6);
  // Judged-only medians: 0.2 → 0.9, not the heuristic ~0.62.
  assert.equal(impact.before.outcome, 0.2);
  assert.equal(impact.after.outcome, 0.9);
  assert.ok(Math.abs(impact.deltas.outcome - 0.7) < 1e-9);

  // Under 5 judged per side → heuristic pool still used.
  const few = new Map([...judgments].slice(0, 2));
  const impactFew = markerImpact(toPoints(sessions, few), marker, 20, 5);
  assert.ok(impactFew.before.outcome > 0.5, "falls back to heuristic median");
});

test("openRouterContent pulls assistant text from a chat completion", () => {
  assert.equal(openRouterContent({ choices: [{ message: { content: '{"score":0.8}' } }] }), '{"score":0.8}');
  assert.equal(openRouterContent({ choices: [{ message: { content: "" } }] }), null);
  assert.equal(openRouterContent({ choices: [] }), null);
  assert.equal(openRouterContent({ error: { message: "nope" } }), null);
  assert.equal(openRouterContent(null), null);
});
