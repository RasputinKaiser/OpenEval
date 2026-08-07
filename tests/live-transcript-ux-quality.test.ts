import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AgentReasoningBlock,
  getReasoningView,
  isAgentReasoningTurn,
  MAX_REASONING_CHARS,
  MAX_REASONING_PARAGRAPHS,
} from "../components/live/AgentReasoningBlock";

const ROOT = path.join(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("reasoning classification and display projection remain bounded", () => {
  assert.equal(isAgentReasoningTurn({ type: "response_item", subtype: "agent_reasoning", label: "Assistant" }), true);
  assert.equal(isAgentReasoningTurn({ type: "message", subtype: "text", label: "Assistant" }), false);

  const longPreview = Array.from({ length: MAX_REASONING_PARAGRAPHS + 3 }, (_, index) => `Paragraph ${index} ${"detail ".repeat(700)}`).join("\n\n");
  const bounded = getReasoningView(longPreview);
  assert.equal(bounded.status, "available");
  assert.ok(bounded.truncated);
  assert.ok(bounded.paragraphs.length <= MAX_REASONING_PARAGRAPHS);
  assert.ok(bounded.paragraphs.join("\n").length <= MAX_REASONING_CHARS);
  assert.equal(getReasoningView("(encrypted reasoning)").status, "encrypted");
  assert.equal(getReasoningView("(1 thinking block)").status, "unavailable");
  assert.equal(getReasoningView("(truncated reasoning)").status, "truncated");
});

test("rendered reasoning uses disclosure, metadata, and safe unavailable copy", () => {
  const available = renderToStaticMarkup(React.createElement(AgentReasoningBlock, {
    preview: "First bounded paragraph.\n\nSecond bounded paragraph.",
    model: "gpt-test",
    at: Date.parse("2026-01-05T10:00:05.000Z"),
  }));
  assert.match(available, /<details/);
  assert.match(available, /<summary/);
  assert.match(available, /Agent reasoning/);
  assert.match(available, /Model: gpt-test/);
  assert.match(available, /First bounded paragraph\./);
  assert.match(available, /Second bounded paragraph\./);

  const unavailable = renderToStaticMarkup(React.createElement(AgentReasoningBlock, { preview: "(encrypted reasoning)" }));
  assert.match(unavailable, /Content unavailable/);
  assert.match(unavailable, /encrypted or was not emitted/);
  assert.match(unavailable, /raw transcript remains authoritative/);
  assert.doesNotMatch(unavailable, /encrypted reasoning/);

  const truncated = renderToStaticMarkup(React.createElement(AgentReasoningBlock, { preview: "(truncated reasoning)" }));
  assert.match(truncated, /Preview truncated/);
  assert.match(truncated, /truncated reasoning marker/);
  assert.doesNotMatch(truncated, /\(truncated reasoning\)/);
});

test("agent reasoning has an explicit bounded disclosure contract", () => {
  const reasoning = read("components/live/AgentReasoningBlock.tsx");

  assert.match(reasoning, /<details/);
  assert.match(reasoning, /<summary/);
  assert.match(reasoning, /Agent reasoning/);
  assert.match(reasoning, /Model unavailable/);
  assert.match(reasoning, /raw transcript/);
  assert.match(reasoning, /MAX_REASONING_PARAGRAPHS/);
  assert.match(reasoning, /MAX_REASONING_CHARS/);
});

test("transcript and Live surfaces keep reasoning distinct from ordinary prose", () => {
  const transcript = read("components/TranscriptClient.tsx");
  const drawer = read("components/live/SessionDrawer.tsx");
  const table = read("components/live/SessionTable.tsx");
  const livePage = read("app/live/page.tsx");
  const sessionPage = read("app/collection/session/page.tsx");

  assert.match(transcript, /isAgentReasoningTurn/);
  assert.match(transcript, /<AgentReasoningBlock/);
  assert.match(drawer, /<AgentReasoningBlock/);
  assert.match(drawer, /errors and agent reasoning/);
  assert.match(table, /No parsed sessions are available in this scan/);
  assert.match(livePage, /ERRORING_TURN_CAP/);
  assert.match(livePage, /isAgentReasoningTurn/);
  assert.match(sessionPage, /Agent reasoning/);
});

test("existing transcript navigation and conversation-first defaults remain wired", () => {
  const transcript = read("components/TranscriptClient.tsx");

  assert.match(transcript, /const defaultFilter: Filter/);
  assert.match(transcript, /totalCounts\?\.chat \?\? countTurns\(turns\)\.chat/);
  assert.match(transcript, /Previous transcript match/);
  assert.match(transcript, /Next transcript match/);
  assert.match(transcript, /Load next .*to continue search/);
});
