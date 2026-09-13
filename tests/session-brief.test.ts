import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildEvidencePacket } from "../lib/insights/evidence";
import { buildSessionBrief } from "../lib/collection/session-brief";

function tempTranscript(lines: unknown[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-session-brief-"));
  const file = path.join(dir, "session.jsonl");
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
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

function codexResult(id: string, output?: string, failed = false) {
  return { type: "response_item", timestamp: "2026-01-01T00:00:03.000Z", payload: { type: "function_call_output", call_id: id, ...(output === undefined ? {} : { output }), ...(failed ? { is_error: true } : {}) } };
}

function codexComplete() {
  return { type: "turn.completed", timestamp: "2026-01-01T00:00:04.000Z", status: "completed" };
}

function packet(lines: unknown[], options: { maxRecords?: number } = {}) {
  const file = tempTranscript(lines);
  try {
    return buildEvidencePacket(file, { sourceId: "fixture", sessionId: "brief", format: "codex-sessions", ...options });
  } finally { cleanup(file); }
}

test("text-only deliverables keep request and final excerpts without inventing checks", () => {
  const value = buildSessionBrief(packet([codexUser("Write a short release note"), codexAssistant("The release note is ready."), codexComplete()]));
  assert.equal(value.request?.excerpt, "Write a short release note");
  assert.equal(value.final?.excerpt, "The release note is ready.");
  assert.equal(value.final?.claimed, true);
  assert.equal(value.final?.label, "Retained assistant output");
  assert.equal(value.final?.provenance, "assistant_output");
  assert.equal(value.final?.finality, "unknown");
  assert.deepEqual(value.attempts, []);
  assert.equal(value.checks[0].status, "unknown");
  assert.equal(value.completion.status, "unknown");
  assert.ok(value.citations.some((citation) => citation.evidenceId === value.request?.evidenceId));
  assert.ok(value.citations.some((citation) => citation.evidenceId === value.final?.evidenceId));
});

test("assistant claims about tests remain unknown without a verification receipt", () => {
  const value = buildSessionBrief(packet([codexUser("Run the parser tests"), codexAssistant("All parser tests passed and the task is complete.")]));
  assert.equal(value.checks.length, 1);
  assert.equal(value.checks[0].status, "unknown");
  assert.match(value.checks[0].summary, /not verification evidence|verification receipt/i);
  assert.equal(value.completion.status, "unknown");
  assert.equal(value.final?.label, "Retained assistant output");
  assert.equal(value.final?.provenance, "assistant_output");
  assert.equal(value.final?.finality, "unknown");
  assert.equal(value.attempts.length, 0);
});

test("failed attempts and checks retain failure evidence as unresolved", () => {
  const value = buildSessionBrief(packet([
    codexUser("Repair the failing check"),
    codexCall("c1", "exec_command", { cmd: "npm test" }),
    codexResult("c1", "Exit code: 1\\n1 failed", true),
  ]));
  assert.equal(value.attempts.length, 1);
  assert.equal(value.attempts[0].status, "fail");
  assert.match(value.attempts[0].excerpt, /npm test/);
  assert.equal(value.checks[0].status, "fail");
  assert.equal(value.unresolved[0].status, "fail");
  assert.equal(value.unresolved[0].evidenceIds.length > 0, true);
  assert.ok(value.citations.some((citation) => value.unresolved[0].evidenceIds.includes(citation.evidenceId)));
});

test("truncated and missing output stay bounded and unknown", () => {
  const value = buildSessionBrief(packet([
    codexUser("Preserve this opening intent"),
    codexCall("c1", "npm test"),
    codexResult("c1"),
    codexAssistant("The check is done."),
  ], { maxRecords: 2 }), { maxAttempts: 1 });
  assert.equal(value.request?.excerpt, "Preserve this opening intent");
  assert.equal(value.bounds.truncated, true);
  assert.equal(value.bounds.attemptLimit, 1);
  assert.equal(value.checks[0].status, "unknown");
  assert.equal(value.unresolved.some((item) => item.status === "unknown"), true);
  assert.ok(value.unresolved.some((item) => /truncated|missing|unknown/i.test(item.summary)));
});

test("a retained assistant fallback never presents opening commentary as a known final", () => {
  const value = buildSessionBrief(packet([
    codexUser("Investigate the issue"),
    codexAssistant("I am checking the active workspace before investigating."),
    codexCall("c1", "exec_command", { cmd: "npm test" }),
    codexResult("c1", "Exit code: 1\\nfailed", true),
    codexCall("c2", "exec_command", { cmd: "git status" }),
    codexResult("c2", "Exit code: 0\\nclean"),
    codexComplete(),
  ], { maxRecords: 4 }));
  assert.equal(value.final?.excerpt, "I am checking the active workspace before investigating.");
  assert.equal(value.final?.label, "Retained assistant output");
  assert.equal(value.final?.finality, "unknown");
  assert.match(value.completion.summary, /transport completion|completed turn/i);
});

test("the same brief is available in the evidence lab and session detail", () => {
  const explorer = fs.readFileSync(path.join(__dirname, "..", "components/SessionEvidenceExplorer.tsx"), "utf8");
  const detail = fs.readFileSync(path.join(__dirname, "..", "app/collection/session/page.tsx"), "utf8");
  const component = fs.readFileSync(path.join(__dirname, "..", "components/SessionBrief.tsx"), "utf8");
  assert.match(explorer, /<SessionBrief packet=\{packet\}/);
  assert.match(detail, /<SessionBrief sourceId=\{resolved\.sourceId\} sessionId=\{resolved\.sessionId\}/);
  assert.match(component, /api\/collection\/evidence/);
  assert.match(component, /reveal excerpt/);
});
