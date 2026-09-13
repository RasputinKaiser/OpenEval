import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildEvidencePacket, type EvidencePacket } from "../lib/insights/evidence";
import { buildUnknownActions, formatUnavailableReason } from "../lib/insights/unknown-actions";

function tempTranscript(lines: string[], extension = ".jsonl"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-unknown-actions-"));
  const file = path.join(dir, `session${extension}`);
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

function cleanup(file: string): void {
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
}

function user(text: string): string {
  return JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: text } });
}

function assistant(text: string): string {
  return JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: text } });
}

function call(id: string, command: string): string {
  return JSON.stringify({ type: "response_item", payload: { type: "function_call", call_id: id, name: "exec_command", arguments: JSON.stringify({ cmd: command }) } });
}

function result(id: string, output?: string): string {
  return JSON.stringify({ type: "response_item", payload: { type: "function_call_output", call_id: id, ...(output === undefined ? {} : { output }) } });
}

function packet(lines: string[], options: { maxRecords?: number } = {}): EvidencePacket {
  const file = tempTranscript(lines);
  try { return buildEvidencePacket(file, { sourceId: "fixture source", sessionId: "unknown session", format: "codex-sessions", ...options }); }
  finally { cleanup(file); }
}

test("bounded omission, missing output, and absent verification are compact and cited", () => {
  const value = buildUnknownActions(packet([
    user("Check the parser"),
    call("c1", "npm test"),
    result("c1"),
    assistant("The tests are done."),
    assistant("More retained context."),
  ], { maxRecords: 2 }));
  assert.deepEqual(value.map((item) => item.cause), ["bounded_omission", "missing_output", "absent_verification"]);
  assert.ok(value.every((item) => item.evidenceIds.length <= 3));
  assert.ok(value.find((item) => item.cause === "bounded_omission")?.limitSummary?.includes("observed within the bounded read"));
  assert.match(value.find((item) => item.cause === "missing_output")?.explanation ?? "", /retained tool receipt lacks output/i);
  assert.match(value.find((item) => item.cause === "absent_verification")?.explanation ?? "", /claims, not checks/i);
  assert.match(value.find((item) => item.cause === "bounded_omission")?.transcriptHref ?? "", /fixture\+source/);
});

test("unsupported format remains distinct and may link to the existing transcript route", () => {
  const file = tempTranscript([], ".db");
  try {
    const value = buildUnknownActions(buildEvidencePacket(file, { sourceId: "hermes", sessionId: "db-session", format: "hermes-sqlite" }));
    assert.equal(value[0].cause, "unsupported_format");
    assert.equal(value.some((item) => item.cause === "unsupported_records"), false);
    assert.equal(value[0].transcriptHref, "/collection/session?sourceId=hermes&sessionId=db-session");
  } finally { cleanup(file); }
});

test("unsupported records and malformed data stay separate", () => {
  const unsupported = packet([user("Inspect this"), JSON.stringify({ type: "unrecognized_shape", value: "opaque" })]);
  const malformed = packet([user("Inspect this"), "not-json"]);
  const unsupportedActions = buildUnknownActions(unsupported);
  const malformedActions = buildUnknownActions(malformed);
  assert.equal(unsupportedActions.some((item) => item.cause === "unsupported_records"), true);
  assert.equal(unsupportedActions.some((item) => item.cause === "malformed_data"), false);
  assert.equal(malformedActions.some((item) => item.cause === "malformed_data"), true);
  assert.equal(malformedActions.some((item) => item.cause === "unsupported_records"), false);
});

test("unavailable source does not promise recovery or fabricate transcript links", () => {
  const value = buildUnknownActions(null, { sourceId: "codex", sessionId: "missing", unavailableReason: "Only the archived summary remains; transcript evidence is unavailable." });
  assert.deepEqual(value.map((item) => item.cause), ["unavailable_source"]);
  assert.equal(value[0].evidenceIds.length, 0);
  assert.equal(value[0].transcriptHref, undefined);
  assert.match(value[0].explanation, /archived summary remains/);
  assert.match(value[0].nextAction, /Refresh the packet|source inventory/);
  assert.match(value[0].nextAction, /does not classify the source as permanently unavailable/);
  assert.equal(formatUnavailableReason("/private/source/path is unavailable"), "The evidence endpoint did not return a bounded packet.");
});

test("unknown action display is wired into both brief and evidence lab", () => {
  const root = path.join(__dirname, "..");
  const brief = fs.readFileSync(path.join(root, "components/SessionBrief.tsx"), "utf8");
  const explorer = fs.readFileSync(path.join(root, "components/SessionEvidenceExplorer.tsx"), "utf8");
  assert.match(brief, /UnknownActionsPanel/);
  assert.match(brief, /buildUnknownActions/);
  assert.match(explorer, /<UnknownActionsPanel actions=\{unavailableActions\}/);
});
