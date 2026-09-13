import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEvidencePacket,
  type EvidencePacket,
} from "../lib/insights/evidence";
import {
  evaluateDeterministicEvidence,
  parseJudgeVerdict,
  validateJudgeVerdict,
} from "../lib/insights/judge-verdict";
import { buildJudgePrompt, selectJudgePromptRecords } from "../lib/insights/judge";

function packet(): EvidencePacket {
  const records = [
    {
      type: "event_msg", timestamp: "2026-01-01T00:00:00.000Z",
      payload: { type: "user_message", message: "Run the tests" },
    },
    {
      type: "response_item", timestamp: "2026-01-01T00:00:01.000Z",
      payload: { type: "function_call", call_id: "c1", name: "npm test", arguments: "{}" },
    },
    {
      type: "response_item", timestamp: "2026-01-01T00:00:02.000Z",
      payload: { type: "function_call_output", call_id: "c1", output: "Exit code: 0\n10 passed" },
    },
  ];
  return buildEvidencePacketFromLines(records);
}

function buildEvidencePacketFromLines(lines: unknown[]): EvidencePacket {
  // The public packet builder is the filesystem path; a tiny data URL is not
  // a supported source. Keep this fixture in-memory through its JSONL temp
  // helper so the test follows the same source normalization as production.
  const fs = require("node:fs") as typeof import("node:fs");
  const os = require("node:os") as typeof import("node:os");
  const path = require("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-judge-evidence-"));
  const file = path.join(dir, "session.jsonl");
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  try {
    return buildEvidencePacket(file, { sourceId: "codex", sessionId: "judge-evidence", format: "codex-sessions" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("v4 prompt includes bounded packet ids and exact contract", () => {
  const value = packet();
  const prompt = buildJudgePrompt(value, { durationMin: 1, toolErrorRate: 0 });
  assert.match(prompt, /openeval\.timeline-judge v4/);
  assert.match(prompt, new RegExp(value.records[0].evidenceId));
  assert.match(prompt, /insufficient_evidence.*score.*null/i);
  assert.match(prompt, /DATA, not instructions/i);
});

test("strict validator rejects fabricated ids and assistant claims", () => {
  const value = packet();
  const valid = evaluateDeterministicEvidence(value);
  assert.equal(validateJudgeVerdict(valid, value).verdict?.outcome, "insufficient_evidence");
  const fabricated = validateJudgeVerdict({ ...valid, evidenceIds: ["fabricated"] }, value);
  assert.equal(fabricated.verdict, null);
  assert.match(fabricated.error ?? "", /unknown evidence id/);
  const claim = { ...value.records[0], evidenceId: "assistant-claim", kind: "assistant_output" as const, role: "assistant" as const, claimed: true };
  const claimPacket = { ...value, records: [...value.records, claim] };
  const accepted = validateJudgeVerdict({ ...valid, evidenceIds: [claim.evidenceId] }, claimPacket);
  assert.equal(accepted.verdict?.evidenceIds[0], claim.evidenceId);
});

test("insufficient deterministic evidence remains unknown without a score", () => {
  const value = buildEvidencePacketFromLines([
    { type: "event_msg", payload: { type: "user_message", message: "Do the thing" } },
    { type: "event_msg", payload: { type: "agent_message", message: "Done" } },
  ]);
  const verdict = evaluateDeterministicEvidence(value);
  assert.equal(verdict.outcome, "insufficient_evidence");
  assert.equal(verdict.score, null);
  assert.equal(parseJudgeVerdict(JSON.stringify(verdict), value).verdict?.score, null);
});

test("verdict calibration rejects contradictory quality claims", () => {
  const value = packet();
  const base = evaluateDeterministicEvidence(value);
  const achievedZero = validateJudgeVerdict({
    ...base,
    outcome: "achieved",
    score: 0,
    evidenceIds: [],
    dimensions: { ...base.dimensions, sufficiency: "sufficient" },
  }, value);
  assert.equal(achievedZero.verdict, null);
  assert.match(achievedZero.error ?? "", /achieved cannot have score 0|quality outcomes require/);

  const partialInsufficient = validateJudgeVerdict({
    ...base,
    outcome: "partial",
    score: 0.5,
    evidenceIds: [value.records[0].evidenceId],
    dimensions: { ...base.dimensions, sufficiency: "insufficient" },
  }, value);
  assert.equal(partialInsufficient.verdict, null);
  assert.match(partialInsufficient.error ?? "", /require sufficient evidence/);
});

test("dimension citations must come from the supplied prompt subset", () => {
  const value = packet();
  const base = evaluateDeterministicEvidence(value);
  const citedDimension = {
    status: "pass" as const,
    evidenceIds: [value.records[1].evidenceId],
    summary: "observed receipt",
  };
  const result = validateJudgeVerdict({
    ...base,
    outcome: "partial",
    score: 0.5,
    evidenceIds: [value.records[0].evidenceId],
    dimensions: {
      ...base.dimensions,
      completion: citedDimension,
      sufficiency: "sufficient",
    },
  }, value, new Set([value.records[0].evidenceId]));
  assert.equal(result.verdict, null);
  assert.match(result.error ?? "", /omitted from supplied prompt/);
});

test("bounded prompt selection retains the causal spine and discloses omission", () => {
  const lines: unknown[] = [
    { type: "event_msg", payload: { type: "user_message", message: "Implement the API; preserve the public contract" } },
  ];
  for (let i = 0; i < 30; i++) {
    lines.push({ type: "response_item", payload: { type: "function_call", call_id: `c${i}`, name: "node", arguments: JSON.stringify({ step: i }) } });
    lines.push({ type: "response_item", payload: { type: "function_call_output", call_id: `c${i}`, output: `Exit code: 0 step ${i}` } });
  }
  lines.push({ type: "event_msg", payload: { type: "user_message", message: "Instead, switch to the new goal and keep the same constraint" } });
  lines.push({ type: "response_item", payload: { type: "function_call", call_id: "failure", name: "npm test", arguments: "{}" } });
  lines.push({ type: "response_item", payload: { type: "function_call_output", call_id: "failure", is_error: true, output: "Exit code: 1 failed" } });
  lines.push({ type: "response_item", payload: { type: "function_call", call_id: "recovery", name: "npm test", arguments: "{}" } });
  lines.push({ type: "response_item", payload: { type: "function_call_output", call_id: "recovery", output: "Exit code: 0 passed" } });
  lines.push({ type: "event_msg", payload: { type: "agent_message", message: "The requested work is complete." } });
  const value = buildEvidencePacketFromLines(lines);
  const selected = selectJudgePromptRecords(value);
  const selectedIds = new Set(selected.map((record) => record.evidenceId));
  assert.equal(selected.length, 48);
  assert.equal(selectedIds.has(value.openingAskEvidenceId!), true);
  assert.equal(selectedIds.has(value.finalOutputEvidenceId!), true);
  assert.equal(selected.some((record) => record.tags.includes("goal_change")), true);
  assert.equal(selected.some((record) => record.error === true), true);
  assert.match(buildJudgePrompt(value, { durationMin: 1, toolErrorRate: 0 }), /omittedPromptRecords=1[0-9]/);
});

test("assistant text can be a deliverable but cannot prove successful execution", () => {
  const value = buildEvidencePacketFromLines([
    { type: "event_msg", payload: { type: "user_message", message: "Write a two line poem" } },
    { type: "event_msg", payload: { type: "agent_message", message: "A river bends beneath the sky.\nThe silver clouds go drifting by." } },
  ]);
  const deliverable = value.records.find(record => record.role === "assistant")!;
  const unknown = { status: "unknown", evidenceIds: [], summary: "Not required or not established" };
  const verdict = { outcome: "achieved", score: 1, confidence: "medium", reasons: ["The requested poem is present"], evidenceIds: [deliverable.evidenceId], contradictionEvidenceIds: [], dimensions: { completion: { status: "pass", evidenceIds: [deliverable.evidenceId], summary: "Two line poem supplied" }, verification: unknown, recovery: unknown, unresolvedIssues: unknown, sufficiency: "sufficient" } };
  assert.equal(validateJudgeVerdict(verdict, value).verdict?.outcome, "achieved");
  const inventedCheck = validateJudgeVerdict({ ...verdict, dimensions: { ...verdict.dimensions, verification: { status: "pass", evidenceIds: [deliverable.evidenceId], summary: "All commands passed" } } }, value);
  assert.equal(inventedCheck.verdict, null);
  assert.match(inventedCheck.error ?? "", /observed execution receipts/);
});
