import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildEvidencePacket,
  readEvidenceRecordsFromLines,
  type EvidencePacket,
} from "../lib/insights/evidence";

function tempTranscript(lines: unknown[], extension = ".jsonl"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-evidence-"));
  const file = path.join(dir, `session${extension}`);
  fs.writeFileSync(file, lines.map((line) => typeof line === "string" ? line : JSON.stringify(line)).join("\n") + "\n");
  return file;
}

function cleanup(file: string): void {
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
}

function codexUser(text: string) {
  return { type: "event_msg", timestamp: "2026-01-01T00:00:00.000Z", payload: { type: "user_message", message: text } };
}

function codexAssistant(text: string) {
  return { type: "event_msg", timestamp: "2026-01-01T00:00:01.000Z", payload: { type: "agent_message", message: text } };
}

function codexCall(id: string, name: string, input: unknown = {}) {
  return { type: "response_item", timestamp: "2026-01-01T00:00:02.000Z", payload: { type: "function_call", call_id: id, name, arguments: JSON.stringify(input) } };
}

function codexResult(id: string, output: string, failed = false) {
  return { type: "response_item", timestamp: "2026-01-01T00:00:03.000Z", payload: { type: "function_call_output", call_id: id, output, ...(failed ? { is_error: true } : {}) } };
}

function codexComplete(status = "completed") {
  return { type: "turn.completed", timestamp: "2026-01-01T00:00:04.000Z", status };
}

test("assistant claims do not become completion or verification evidence", () => {
  const file = tempTranscript([codexUser("Fix the parser"), codexAssistant("All tests pass and the task is complete.")]);
  try {
    const packet = buildEvidencePacket(file, { sourceId: "codex", sessionId: "s-claims", format: "codex-sessions" });
    assert.equal(packet.evaluation.completionEvidence.status, "unknown");
    assert.equal(packet.evaluation.verification.status, "unknown");
    assert.equal(packet.evaluation.sufficiency, "unknown");
    assert.equal(packet.evaluation.ignoredClaimEvidenceIds.length, 1);
    assert.equal(packet.openingAskEvidenceId != null, true);
  } finally { cleanup(file); }
});

test("observed success has tool receipts, verification, and sufficient evidence", () => {
  const file = tempTranscript([
    codexUser("Run the tests"),
    codexCall("c1", "npm test"),
    codexResult("c1", "Exit code: 0\n12 passed, 0 failed"),
    codexComplete(),
  ]);
  try {
    const packet = buildEvidencePacket(file, { sourceId: "codex", sessionId: "s-success", format: "codex-sessions" });
    assert.equal(packet.evaluation.completionEvidence.status, "unknown");
    assert.match(packet.evaluation.completionEvidence.outcome, /transport completion/);
    assert.equal(packet.evaluation.verification.status, "pass");
    assert.equal(packet.evaluation.recovery.status, "pass");
    assert.equal(packet.evaluation.unresolvedIssues.status, "pass");
    assert.equal(packet.evaluation.sufficiency, "sufficient", "verification receipts are sufficient evidence even when goal completion is unknown");
    assert.equal(packet.records.filter((record) => record.kind === "tool_call").length, 1);
    assert.equal(packet.records.filter((record) => record.kind === "tool_result").length, 1);
  } finally { cleanup(file); }
});

test("failed tool receipt followed by same-tool success is explicit recovery", () => {
  const file = tempTranscript([
    codexUser("Repair the failing check"),
    codexCall("c1", "npm test"),
    codexResult("c1", "Exit code: 1\n1 failed", true),
    codexCall("c2", "npm test"),
    codexResult("c2", "Exit code: 0\n12 passed"),
    codexComplete(),
  ]);
  try {
    const packet = buildEvidencePacket(file, { sourceId: "codex", sessionId: "s-recovery", format: "codex-sessions" });
    assert.equal(packet.evaluation.recovery.status, "pass");
    assert.equal(packet.evaluation.recovery.outcome, "matching command/check recovered");
    assert.equal(packet.evaluation.unresolvedIssues.status, "pass");
  } finally { cleanup(file); }
});

test("unresolved tool errors and changed goals retain explicit episode boundaries", () => {
  const file = tempTranscript([
    codexUser("Investigate the bug"),
    codexCall("c1", "shell"),
    codexResult("c1", "Exit code: 1\ncommand failed", true),
    codexUser("Instead, change the goal to document the failure"),
    codexAssistant("I documented it."),
  ]);
  try {
    const packet = buildEvidencePacket(file, { sourceId: "codex", sessionId: "s-goal", format: "codex-sessions" });
    assert.equal(packet.episodes.length, 2);
    assert.equal(packet.episodes[1].boundary, "explicit");
    assert.equal(packet.evaluation.recovery.status, "fail");
    assert.equal(packet.evaluation.unresolvedIssues.status, "fail");
    assert.equal(packet.evaluation.sufficiency, "sufficient", "a clear observed failure is sufficient evidence of failure");
    assert.equal(packet.feedback.length, 1);
  } finally { cleanup(file); }
});

test("same tool name with a different command is not recovery", () => {
  const file = tempTranscript([
    codexUser("Run the checks"),
    codexCall("c1", "exec_command", { cmd: "pytest" }),
    codexResult("c1", "Exit code: 1\n1 failed", true),
    codexCall("c2", "exec_command", { cmd: "git status" }),
    codexResult("c2", "Exit code: 0\nclean"),
  ]);
  try {
    const packet = buildEvidencePacket(file, { sourceId: "codex", sessionId: "s-unrelated", format: "codex-sessions" });
    assert.equal(packet.evaluation.recovery.status, "fail");
    assert.equal(packet.evaluation.unresolvedIssues.status, "fail");
  } finally { cleanup(file); }
});

test("verification requires a verification invocation, not a passing word in arbitrary output", () => {
  const file = tempTranscript([
    codexUser("Inspect the fixture"),
    codexCall("c1", "exec_command", { cmd: "cat tests/fixture.txt" }),
    codexResult("c1", "passed"),
  ]);
  try {
    const packet = buildEvidencePacket(file, { sourceId: "codex", sessionId: "s-not-test", format: "codex-sessions" });
    assert.equal(packet.evaluation.verification.status, "unknown");
  } finally { cleanup(file); }
});

test("bounded retention keeps the opening request and recent failure evidence", () => {
  const lines: unknown[] = [codexUser("Preserve the opening request")];
  for (let index = 0; index < 12; index++) lines.push(codexAssistant(`intermediate update ${index}`));
  lines.push(codexCall("tail", "exec_command", { cmd: "pytest" }), codexResult("tail", "Exit code: 1\nfailed", true));
  const file = tempTranscript(lines);
  try {
    const packet = buildEvidencePacket(file, { sourceId: "codex", sessionId: "s-retain", format: "codex-sessions", maxRecords: 4 });
    assert.equal(packet.records.some((record) => record.tags.includes("opening_ask")), true);
    assert.equal(packet.records.some((record) => record.kind === "error"), true);
    assert.equal(packet.bounds.truncated, true);
  } finally { cleanup(file); }
});

test("missing output, truncation, unsupported input, and noncoding sessions stay unknown", () => {
  const missingOutput = tempTranscript([codexUser("Check status"), codexCall("c1", "status"), { type: "response_item", payload: { type: "function_call_output", call_id: "c1" } }]);
  const unsupported = tempTranscript([], ".db");
  try {
    const missing = buildEvidencePacket(missingOutput, { sourceId: "codex", sessionId: "s-missing", format: "codex-sessions" });
    assert.equal(missing.records.some((record) => record.missingOutput), true);
    assert.equal(missing.evaluation.verification.status, "unknown");
    assert.equal(missing.evaluation.sufficiency, "unknown");

    const unknown = buildEvidencePacket(unsupported, { sourceId: "hermes", sessionId: "s-db", format: "hermes-sqlite" });
    assert.equal(unknown.bounds.unsupported, true);
    assert.equal(unknown.evaluation.sufficiency, "unknown");

    const noncodingFile = tempTranscript([codexUser("What is the weather?"), codexAssistant("It is sunny.")]);
    try {
      const noncoding = buildEvidencePacket(noncodingFile, { sourceId: "codex", sessionId: "s-chat", format: "codex-sessions" });
      assert.equal(noncoding.evaluation.verification.status, "unknown");
      assert.equal(noncoding.evaluation.sufficiency, "unknown");
    } finally { cleanup(noncodingFile); }
  } finally { cleanup(missingOutput); cleanup(unsupported); }
});

test("Hermes-shaped JSON and in-memory streams retain tool results", () => {
  const file = tempTranscript([], ".json");
  fs.writeFileSync(file, JSON.stringify({ session_id: "hermes-1", messages: [
    { role: "user", content: "Run the test" },
    { role: "assistant", content: "", tool_calls: [{ id: "h1", function: { name: "pytest", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "h1", content: "5 passed", is_error: false },
  ] }));
  try {
    const packet = buildEvidencePacket(file, { sourceId: "hermes", format: "hermes-json" });
    assert.equal(packet.sessionId, "hermes-1");
    assert.equal(packet.records.some((record) => record.kind === "tool_result"), true);
    const records = readEvidenceRecordsFromLines([JSON.stringify(codexUser("Hello")), JSON.stringify(codexAssistant("Hi"))], { sourceId: "codex", sessionId: "stream-1" });
    assert.deepEqual(records.map((record) => record.role), ["user", "assistant"]);
  } finally { cleanup(file); }
});

test("packet IDs and digest remain stable for the same bounded source", () => {
  const file = tempTranscript([codexUser("Keep this stable"), codexCall("c1", "echo"), codexResult("c1", "Exit code: 0")]);
  try {
    const a: EvidencePacket = buildEvidencePacket(file, { sourceId: "codex", sessionId: "stable", format: "codex-sessions" });
    const b: EvidencePacket = buildEvidencePacket(file, { sourceId: "codex", sessionId: "stable", format: "codex-sessions" });
    assert.equal(a.contentDigest, b.contentDigest);
    assert.deepEqual(a.records.map((record) => record.evidenceId), b.records.map((record) => record.evidenceId));
  } finally { cleanup(file); }
});
