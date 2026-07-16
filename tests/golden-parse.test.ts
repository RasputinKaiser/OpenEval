import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { summarizeCodexSessionFile, summarizeLiveSessionFile, type LiveSession } from "../lib/live";
import { _setCacheDbForTest } from "../lib/live-cache";
import { JUDGE_PROMPT_MARKER } from "../lib/insights/signals";

/**
 * Golden-transcript regression corpus. Each fixture under tests/fixtures/ is a
 * HAND-CRAFTED synthetic session (never a copied real one) and each test pins
 * the parser's output for the fields that matter. If one of these breaks, the
 * parser's observable behavior changed — bump PARSER_VERSION in lib/live-cache.ts
 * deliberately and update the golden values here in the same change.
 */

const FIXTURES = path.join(process.cwd(), "tests", "fixtures");

// Parsing goes through the live-cache; point it at a throwaway in-memory DB so
// golden runs never touch the repo's real data/live-cache.db.
const conn = new Database(":memory:");
_setCacheDbForTest(conn);
after(() => {
  _setCacheDbForTest(null);
  conn.close();
});

function snapshot(s: LiveSession) {
  return {
    sessionId: s.sessionId,
    project: s.project,
    displayTitle: s.displayTitle,
    lastPromptPreview: s.lastPromptPreview,
    model: s.model,
    metricSources: s.metricSources,
    durationMs: s.durationMs,
    numTurns: s.numTurns,
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    cacheReadTokens: s.cacheReadTokens,
    cacheCreateTokens: s.cacheCreateTokens,
    totalTokens: s.totalTokens,
    toolCalls: s.toolCalls,
    toolErrors: s.toolErrors,
    toolErrorRate: s.toolErrorRate,
    thinkingBlocks: s.thinkingBlocks,
    textBlocks: s.textBlocks,
    usageSegmentCount: s.usageSegments.length,
    dataQuality: s.dataQuality,
    outcomeSignals: s.outcomeSignals,
  };
}

test("golden: claude-projects interactive session (no result record)", () => {
  const file = path.join(FIXTURES, "claude-interactive.jsonl");
  const session = summarizeLiveSessionFile(file, "-Users-tester-projects-demo", Date.parse("2026-01-05T10:10:30.000Z"));
  assert.ok(session);

  assert.deepEqual(snapshot(session), {
    sessionId: "golden-claude-interactive",
    project: "/Users/tester/projects/demo",
    displayTitle: null,
    lastPromptPreview: null,
    model: "test-model-x",
    metricSources: {
      model: "measured",
      tokens: "measured",
      cost: "inferred",
      duration: "inferred",
      turns: "inferred",
    },
    durationMs: 630_000, // 10:00:00 -> 10:10:30, inferred from record timestamps
    numTurns: 3, // real user prompts only: tool_results and the sidechain brief don't count
    inputTokens: 2000,
    outputTokens: 500,
    cacheReadTokens: 400,
    cacheCreateTokens: 100,
    totalTokens: 3000,
    toolCalls: 1,
    toolErrors: 1,
    toolErrorRate: 1,
    thinkingBlocks: 1,
    textBlocks: 3,
    usageSegmentCount: 2, // one per assistant turn carrying usage
    dataQuality: 91, // -3 inferred turns, -6 toolErrorRate > 0.25
    outcomeSignals: {
      userPositive: 1, // "perfect, thanks"
      userNegative: 1, // "no, that's still broken"
      rephrases: 1, // the "no," lead marks a rephrase
      errorTail: false,
      testsPassedTail: false,
      reworkFiles: 0,
    },
  });

  // Cost is estimated from tokens + model; pin provenance, not the rate table.
  assert.ok(session.costUsd > 0);
  assert.equal(session.traceGraph.sidechainMessages, 1);
  assert.equal(session.traceGraph.rootMessages, 1);
  assert.equal(session.traceGraph.orphanMessages, 0);
  assert.equal(session.modeSummary.gitBranch, "main");
  assert.equal(session.cliVersion, "2.0.1");
  assert.ok(session.parseWarnings.includes("no final result event found"));
  assert.ok(session.parseWarnings.includes("turn count inferred from user messages"));
});

test("golden: codex NEW rollout (session_meta/turn_context/event_msg/response_item)", () => {
  const file = path.join(FIXTURES, "codex-rollout-new.jsonl");
  const session = summarizeCodexSessionFile(file, "2026/01/06", Date.parse("2026-01-06T09:00:08.000Z"));
  assert.ok(session);

  assert.deepEqual(snapshot(session), {
    sessionId: "golden-codex-new",
    project: "/Users/tester/projects/demo",
    // IDE-context wrapper is stripped: the title/preview is the actual ask.
    displayTitle: "Refactor the parser to stream lines",
    lastPromptPreview: "Refactor the parser to stream lines",
    model: "test-codex-model", // from turn_context, not session_meta
    metricSources: {
      model: "measured",
      tokens: "measured",
      cost: "inferred",
      duration: "inferred",
      turns: "inferred",
    },
    durationMs: 8000,
    numTurns: 1, // one turn_context record; response_item/event echoes are not extra turns
    // input_tokens includes the cached portion; fresh = 8000 - 2500.
    inputTokens: 5500,
    outputTokens: 650,
    cacheReadTokens: 2500,
    cacheCreateTokens: 0,
    totalTokens: 8650,
    toolCalls: 1,
    toolErrors: 1, // JSON envelope {output, metadata:{exit_code:2}} is a structured failure
    toolErrorRate: 1,
    thinkingBlocks: 1,
    textBlocks: 2,
    usageSegmentCount: 2, // one per token_count event
    dataQuality: 91,
    outcomeSignals: {
      userPositive: 0,
      userNegative: 0,
      rephrases: 0,
      errorTail: false,
      testsPassedTail: false,
      reworkFiles: 0,
    },
  });

  assert.ok(session.costUsd > 0);
  assert.ok(session.parseWarnings.includes("turn count inferred from turn context records"));
  assert.equal(session.isError, true);
  assert.equal(session.userType, "codex_cli");
  assert.equal(session.modeSummary.entrypoint, "cli");
  assert.equal(session.cliVersion, "0.99.0");
  const shell = session.toolDurations.find((d) => d.name === "shell");
  assert.ok(shell);
  assert.equal(shell!.count, 1);
  assert.equal(shell!.p50Ms, 2000);
  assert.equal(shell!.errors, 1);
  const last = session.usageSegments[session.usageSegments.length - 1];
  assert.equal(last.cumulativeInput, 5500);
  assert.equal(last.cumulativeOutput, 650);
});

test("golden: codex OLD rollout (response_item message records, no token_count)", () => {
  const file = path.join(FIXTURES, "codex-rollout-old.jsonl");
  const session = summarizeCodexSessionFile(file, "2026/01/04", Date.parse("2026-01-04T14:00:04.000Z"));
  assert.ok(session);

  assert.deepEqual(snapshot(session), {
    sessionId: "golden-codex-old",
    project: "/Users/tester/projects/ledger",
    displayTitle: "Sum the totals column in data.csv",
    lastPromptPreview: "Sum the totals column in data.csv", // old Codex response_item user records are now captured too
    model: null,
    metricSources: {
      model: "missing",
      tokens: "missing",
      cost: "missing",
      duration: "inferred",
      turns: "inferred",
    },
    durationMs: 4000,
    numTurns: 1, // one legacy response_item user message
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    totalTokens: 0,
    toolCalls: 1,
    toolErrors: 0, // "Exit code: 0" marker wins over any text sniffing
    toolErrorRate: 0,
    thinkingBlocks: 0,
    textBlocks: 2,
    usageSegmentCount: 0,
    dataQuality: 63, // -12 model, -14 tokens, -8 cost, -3 inferred turns
    outcomeSignals: {
      userPositive: 0,
      userNegative: 0,
      rephrases: 0,
      errorTail: false,
      testsPassedTail: false,
      reworkFiles: 0,
    },
  });

  assert.equal(session.costUsd, 0);
  assert.ok(session.parseWarnings.includes("turn count inferred from user messages"));
  assert.ok(session.parseWarnings.includes("model missing from trace"));
  assert.ok(session.parseWarnings.includes("token usage missing from trace"));
  assert.ok(session.parseWarnings.includes("source: codex_cli 0.20.0"));
});

test("golden: judge-marker session parses to null (dropped, never a session)", () => {
  const file = path.join(FIXTURES, "judge-marker-session.jsonl");
  // Guard against fixture drift: the fixture must genuinely start with the
  // live marker constant, or this test would pass for the wrong reason.
  const firstLine = JSON.parse(fs.readFileSync(file, "utf8").split("\n")[0]);
  assert.ok(String(firstLine.message.content).startsWith(JUDGE_PROMPT_MARKER));

  const session = summarizeLiveSessionFile(file, "-Users-tester-projects-demo", Date.parse("2026-01-07T08:00:02.000Z"));
  assert.equal(session, null);
});
