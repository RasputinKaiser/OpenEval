import { normalizeNativeEvent, grokMarkdownRecords } from "./native-events";
import { agentDbRecords } from "./parse-agent-db";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { hermesJsonToRecords } from "../adapters/hermes";
import { hermesDbMessagesToRecords } from "./parse-hermes-db";
import type { LiveTraceFormat, LiveTranscriptTurn, TranscriptCursorState, TranscriptNormalization, TranscriptResult } from "./types";
import {
  isTruncatedJsonlRecord,
  MAX_JSONL_RECORD_BYTES,
  NON_WS_RE,
  codexToolOutputError,
  jsonPreview as compactPreview,
  parseTimestamp,
  readFileLineRecords,
  readFileLines,
  TRUNCATED_JSONL_RECORD_PREFIX,
} from "./util";

// Transcript content is evidence, not a dashboard teaser. The raw-record reader
// already caps each record at 4 MiB; keep text up to that boundary.
const jsonPreview = (value: unknown, max = MAX_JSONL_RECORD_BYTES) => compactPreview(value, max);

const TRANSCRIPT_TURN_CAP = 20_000;
/** Error context is useful only as a bounded drawer timeline, not a transcript dump. */
export const ERRORING_TURN_CAP = 240;

const HERMES_TRANSCRIPT_MAX_BYTES = 32 * 1024 * 1024;

export const TRANSCRIPT_WINDOW_CAP = 240;

interface TranscriptParseState {
  calls: Map<string, { name: string; at?: number }>;
  lastCodexMessage?: {
    envelope: "event_msg" | "response_item";
    fingerprint: string;
    recordIndex: number;
    role: "user" | "assistant";
  };
}

interface ParseRecordsOptions {
  state?: TranscriptParseState;
  startRecordIndex?: number;
  maxTurns?: number;
  skipCandidates?: number;
  format?: LiveTraceFormat;
}

interface ParseRecordsResult extends TranscriptResult {
  state: TranscriptParseState;
  recordIndex: number;
  pendingCandidates?: number;
}

function parseTranscriptRecords(records: Iterable<string>, options: ParseRecordsOptions = {}): ParseRecordsResult {
  const turns: LiveTranscriptTurn[] = [];
  const state: TranscriptParseState = options.state ?? { calls: new Map() };
  const normalization: TranscriptNormalization = {
    rawRecords: 0,
    suppressedMirrors: 0,
    compoundRecords: 0,
  };
  let index = options.startRecordIndex ?? 0;
  let pendingCandidates: number | undefined;
  let windowBytes = 0;
  for (const line of records) {
    if (!NON_WS_RE.test(line)) continue;
    index++;
    normalization.rawRecords++;
    if (isTruncatedJsonlRecord(line)) {
      turns.push({
        type: "truncated",
        severity: "warning",
        label: `Malformed/truncated JSONL record ${index}`,
        preview: `Record exceeded the ${MAX_JSONL_RECORD_BYTES}-byte ingestion limit and was not parsed. ${line.slice(TRUNCATED_JSONL_RECORD_PREFIX.length, 420)}`,
      });
    } else {
      try {
        const obj = normalizeNativeEvent(JSON.parse(line), options.format);
        const expanded = expandCompoundTranscriptRecord(obj, state);
        const candidates = expanded ?? [toTranscriptTurn(obj, index, state)];
        if (expanded && expanded.length > 1) normalization.compoundRecords++;
        for (let ci = 0; ci < candidates.length; ci++) {
          if (index === (options.startRecordIndex ?? 0) + 1 && ci < (options.skipCandidates ?? 0)) continue;
          if (options.maxTurns != null && turns.length >= options.maxTurns) { pendingCandidates = ci; break; }
          const turn = candidates[ci];
          const turnBytes = Buffer.byteLength(JSON.stringify(turn));
          if (options.maxTurns != null && turns.length > 0 && windowBytes + turnBytes > 8 * 1024 * 1024) { pendingCandidates = ci; break; }
          windowBytes += turnBytes;
          if (suppressCodexMirror(obj, turn, index, state)) {
            normalization.suppressedMirrors++;
            continue;
          }
          turns.push(turn);
          if (turns.length >= (options.maxTurns ?? TRANSCRIPT_TURN_CAP)) { if (ci + 1 < candidates.length) pendingCandidates = ci + 1; break; }
        }
      } catch {
        turns.push({
          type: "malformed",
          severity: "warning",
          label: `Malformed line ${index}`,
          preview: line.slice(0, 420),
        });
      }
    }
    if (pendingCandidates !== undefined && options.maxTurns != null) break;
    if (turns.length >= (options.maxTurns ?? TRANSCRIPT_TURN_CAP)) {
      if (options.maxTurns != null) break;
      turns.push({
        type: "truncated",
        severity: "info",
        label: `Transcript truncated at ${TRANSCRIPT_TURN_CAP} lines`,
        preview: "This session is very large; earlier lines are shown.",
      });
      break;
    }
  }
  return {
    turns,
    truncated: turns.some((turn) => turn.type === "truncated"),
    normalization,
    state,
    recordIndex: index,
    pendingCandidates,
  };
}

function serializeCursorState(parsed: ParseRecordsResult): TranscriptCursorState {
  return {
    calls: [...parsed.state.calls.entries()].slice(-512),
    ...(parsed.state.lastCodexMessage ? { lastCodexMessage: parsed.state.lastCodexMessage } : {}),
    recordIndex: parsed.recordIndex,
    semanticTurns: parsed.turns.length,
  };
}

function restoreCursorState(state: TranscriptCursorState | undefined): TranscriptParseState {
  return {
    calls: new Map(state?.calls ?? []),
    ...(state?.lastCodexMessage ? { lastCodexMessage: state.lastCodexMessage } : {}),
  };
}

export interface TranscriptWindowOptions {
  byteOffset?: number;
  state?: TranscriptCursorState;
  /** Session id within a multi-session container (hermes-sqlite DBs). */
  sessionId?: string;
}

export interface TranscriptWindowResult extends TranscriptResult {
  offset: number;
  nextByteOffset: number;
  nextState?: TranscriptCursorState;
  done: boolean;
  revision: { size: number; mtimeMs: number; fingerprint: string };
}

function boundedFileFingerprint(filePath: string, stat: fs.Stats): string {
  const hash = createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  try {
    const sampleSize = Math.min(64 * 1024, stat.size);
    const head = Buffer.alloc(sampleSize);
    if (sampleSize > 0) hash.update(head.subarray(0, fs.readSync(fd, head, 0, sampleSize, 0)));
    if (stat.size > sampleSize) {
      const tailSize = Math.min(64 * 1024, stat.size);
      const tail = Buffer.alloc(tailSize);
      hash.update(tail.subarray(0, fs.readSync(fd, tail, 0, tailSize, Math.max(0, stat.size - tailSize))));
    }
  } finally {
    fs.closeSync(fd);
  }
  if (fs.existsSync(`${filePath}-wal`)) {
    const wal = fs.statSync(`${filePath}-wal`);
    hash.update(`${wal.size}:${wal.mtimeMs}:${boundedFileFingerprint(`${filePath}-wal`, wal)}`);
  }
  return hash.digest("hex");
}

function* readFileLinesWithOffsets(filePath: string, startOffset: number): Generator<{ line: string; nextOffset: number }> {
  yield* readFileLineRecords(filePath, startOffset);
}

/** Read one bounded semantic window without reparsing records before the cursor. */
export function readTranscriptWindow(filePath: string, format: LiveTraceFormat | undefined, options: TranscriptWindowOptions = {}): TranscriptWindowResult {
  const stat = fs.statSync(filePath);
  const byteOffset = options.byteOffset ?? 0;
  if (!Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset > stat.size) throw new Error("Invalid transcript cursor position");
  const cursor = options.state;
  const startRecordIndex = cursor?.recordIndex ?? 0;
  const revision = { size: stat.size, mtimeMs: stat.mtimeMs, fingerprint: boundedFileFingerprint(filePath, stat) };
  const isHermesJson = format === "hermes-json" || path.extname(filePath).toLowerCase() === ".json";
  if (format === "agent-sqlite" || format === "grok-markdown") {
    const parsed = parseTranscriptRecords(format === "agent-sqlite" ? agentDbRecords(filePath, options.sessionId ?? "") : grokMarkdownRecords(filePath));
    const offset = cursor?.semanticTurns ?? 0;
    const turns = parsed.turns.slice(offset, offset + TRANSCRIPT_WINDOW_CAP);
    const done = offset + turns.length >= parsed.turns.length;
    return { turns, truncated: parsed.truncated, normalization: parsed.normalization, offset, done, nextByteOffset: stat.size, revision,
      ...(!done ? { nextState: { calls: [], recordIndex: parsed.recordIndex, semanticTurns: offset + turns.length } } : {}) };
  }
  if (format === "hermes-sqlite" || (!isHermesJson && path.extname(filePath).toLowerCase() === ".db")) {
    // One DB file expands to many sessions; `options.sessionId` selects one.
    // The whole message projection is bounded, so a "window" is simply the
    // next slice of the parsed turn list — same shape as the hermes-json path.
    const parsed = parseHermesDbSessionTranscript(filePath, options.sessionId ?? "");
    const offset = cursor?.semanticTurns ?? 0;
    const turns = parsed.turns.slice(offset, offset + TRANSCRIPT_WINDOW_CAP);
    const done = Boolean(parsed.error) || offset + turns.length >= parsed.turns.length;
    return {
      ...parsed,
      turns,
      offset,
      done,
      nextByteOffset: stat.size,
      ...(!done ? { nextState: { calls: [], recordIndex: parsed.normalization?.rawRecords ?? 0, semanticTurns: offset + turns.length } } : {}),
      revision,
    };
  }
  if (isHermesJson) {
    const parsed = parseSessionTranscript(filePath, format);
    const offset = cursor?.semanticTurns ?? 0;
    const turns = parsed.turns.slice(offset, offset + TRANSCRIPT_WINDOW_CAP);
    const done = parsed.error ? true : offset + turns.length >= parsed.turns.length;
    return {
      ...parsed,
      turns,
      offset,
      done,
      nextByteOffset: stat.size,
      ...(!done ? { nextState: { calls: [], recordIndex: parsed.normalization?.rawRecords ?? 0, semanticTurns: offset + turns.length } } : {}),
      revision,
    };
  }
  let nextByteOffset = byteOffset;
  let lastRecordOffset = byteOffset;
  let lastState = restoreCursorState(cursor);
  const parseState = restoreCursorState(cursor);
  const records = (function* () {
    for (const record of readFileLinesWithOffsets(filePath, byteOffset)) {
      lastRecordOffset = nextByteOffset;
      lastState = { calls: new Map(parseState.calls), ...(parseState.lastCodexMessage ? { lastCodexMessage: { ...parseState.lastCodexMessage } } : {}) };
      nextByteOffset = record.nextOffset;
      yield record.line;
    }
  })();
  const parsed = parseTranscriptRecords(records, {
    state: parseState,
    startRecordIndex,
    skipCandidates: cursor?.skipCandidates,
    format,
    maxTurns: TRANSCRIPT_WINDOW_CAP,
  });
  if (parsed.pendingCandidates !== undefined) nextByteOffset = lastRecordOffset;
  const done = parsed.pendingCandidates === undefined && nextByteOffset >= stat.size;
  const semanticTurns = (cursor?.semanticTurns ?? 0) + parsed.turns.length;
  return {
    turns: parsed.turns,
    truncated: parsed.truncated,
    normalization: parsed.normalization,
    offset: cursor?.semanticTurns ?? 0,
    nextByteOffset,
    done,
    ...(done ? {} : { nextState: { ...serializeCursorState(parsed), semanticTurns,
      ...(parsed.pendingCandidates !== undefined ? { calls: [...lastState.calls.entries()].slice(-512), lastCodexMessage: lastState.lastCodexMessage, recordIndex: parsed.recordIndex - 1, skipCandidates: parsed.pendingCandidates } : {}) } }),
    revision,
  };
}

/**
 * Transcript projection for one session inside a hermes-sqlite ledger. The
 * DB-backed message rows are projected to Claude-style records and run through
 * the shared semantic-turn pipeline, so drawer rendering, reasoning cards, and
 * tool pairing behave exactly like every other format. An absent/blank
 * sessionId yields an explicit error, never another session's turns.
 */
export function parseHermesDbSessionTranscript(filePath: string, sessionId: string): TranscriptResult {
  if (!sessionId) return { turns: [], error: "A session id is required to open a Hermes database transcript." };
  try {
    const records = hermesDbMessagesToRecords(filePath, sessionId);
    if (records.length === 0) return { turns: [], error: "No conversation messages were found for this session in the Hermes ledger." };
    return parseTranscriptRecords(records);
  } catch (e) {
    return { turns: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export function parseSessionTranscript(filePath: string, format?: LiveTraceFormat, sessionId?: string): TranscriptResult {
  try {
    if (format === "agent-sqlite") return parseTranscriptRecords(agentDbRecords(filePath, sessionId ?? ""));
    if (format === "grok-markdown") return parseTranscriptRecords(grokMarkdownRecords(filePath));
    if (format === "hermes-sqlite" || path.extname(filePath).toLowerCase() === ".db") {
      return parseHermesDbSessionTranscript(filePath, sessionId ?? "");
    }
    const isHermes = format === "hermes-json" || path.extname(filePath).toLowerCase() === ".json";
    if (isHermes) {
      const stat = fs.statSync(filePath);
      if (stat.size > HERMES_TRANSCRIPT_MAX_BYTES) {
        return { turns: [], error: `Hermes transcript exceeds the ${HERMES_TRANSCRIPT_MAX_BYTES / (1024 * 1024)} MiB viewer limit` };
      }
      let raw = "";
      for (const line of readFileLines(filePath)) raw += line + "\n";
      const records = hermesJsonToRecords(raw);
      if (records.length === 0) return { turns: [], error: "Unsupported single-JSON transcript format" };
      return parseTranscriptRecords(records);
    }
    // Stream (don't readFileSync a giant string) and cap turns so a multi-hundred-MB
    // JSONL session can be opened without exhausting memory.
    return parseTranscriptRecords(readFileLines(filePath), { format });
  } catch (e) {
    return { turns: [], error: e instanceof Error ? e.message : String(e) };
  }
}

function isErroringTurn(turn: LiveTranscriptTurn): boolean {
  return turn.severity === "error" || turn.severity === "warning";
}

export function getErroringTurns(filePath: string, format?: LiveTraceFormat, sessionId?: string): TranscriptResult {
  const parsed = parseSessionTranscript(filePath, format, sessionId);
  if (parsed.error) return { turns: [], error: parsed.error };
  const keep = new Set<number>();
  parsed.turns.forEach((turn, index) => {
    if (!isErroringTurn(turn)) return;
    keep.add(Math.max(0, index - 1));
    keep.add(index);
    keep.add(Math.min(parsed.turns.length - 1, index + 1));
  });
  const indexes = [...keep].sort((a, b) => a - b);
  const bounded = indexes.length > ERRORING_TURN_CAP ? indexes.slice(-ERRORING_TURN_CAP) : indexes;
  return {
    turns: bounded.map((index) => parsed.turns[index]),
    truncated: Boolean(parsed.truncated || indexes.length > bounded.length),
  };
}

/**
 * Joined text of an OpenAI/Anthropic-style content value. Providers have
 * shipped this as a string, a block array, or a wrapper object containing
 * `text`/`content`/`summary`; keep the extractor tolerant while bounding the
 * amount of untrusted reasoning text retained by a single semantic turn.
 */
function contentText(content: unknown, depth = 0): string {
  if (typeof content === "string") return content.slice(0, MAX_JSONL_RECORD_BYTES);
  if (!content || depth > 3) return "";
  if (Array.isArray(content)) {
    let out = "";
    for (const block of content) {
      const text = contentText(block, depth + 1);
      if (!text) continue;
      out += out ? `\n${text}` : text;
      if (out.length >= MAX_JSONL_RECORD_BYTES) break;
    }
    return out.slice(0, MAX_JSONL_RECORD_BYTES);
  }
  if (typeof content !== "object") return "";
  const block = content as Record<string, unknown>;
  if (typeof block.text === "string") return block.text.slice(0, MAX_JSONL_RECORD_BYTES);
  for (const key of ["content", "summary", "thinking", "reasoning", "text"]) {
    const text = contentText(block[key], depth + 1);
    if (text) return text;
  }
  return "";
}

type ReasoningSource = "codex" | "claude" | "generic";
type ReasoningKind = "summary" | "thinking" | "encrypted" | "truncated";

function isReasoningTag(value: unknown): boolean {
  const tag = String(value ?? "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  return tag === "reasoning" || tag === "agent_reasoning" || tag === "thinking" || tag === "agent_thinking"
    || tag === "redacted_thinking" || tag.endsWith("_reasoning");
}

function reasoningTurn(
  type: string,
  subtype: string | undefined,
  at: number | undefined,
  payload: any,
  source: ReasoningSource,
  fallbackKind: ReasoningKind = "summary",
): LiveTranscriptTurn {
  const text = contentText(payload?.summary)
    || contentText(payload?.thinking)
    || contentText(payload?.reasoning)
    || contentText(payload?.content)
    || contentText(payload?.text);
  const rawType = String(payload?.type ?? subtype ?? "").toLowerCase();
  const encrypted = /redacted|encrypted/.test(rawType)
    || payload?.encrypted_content != null
    || payload?.redacted_content != null;
  const kind: ReasoningKind = text
    ? fallbackKind
    : encrypted
      ? "encrypted"
      : /truncated/.test(rawType)
        ? "truncated"
        : fallbackKind;
  const preview = text || (kind === "encrypted" ? "(encrypted reasoning)" : kind === "truncated" ? "(truncated reasoning)" : "(unavailable reasoning)");
  return {
    type,
    subtype: subtype ?? (isReasoningTag(payload?.type) ? String(payload.type) : "reasoning"),
    severity: "info",
    at,
    role: "assistant",
    label: fallbackKind === "thinking" ? "Thinking" : "Reasoning",
    preview: jsonPreview(preview),
    reasoning: { kind, source },
  };
}

function codexMessageProjection(payload: any): { text: string; images: number; files: number } {
  const content = payload?.content;
  if (!Array.isArray(content)) return { text: contentText(content), images: 0, files: 0 };
  const images = content.filter((block: any) => block?.type === "input_image" || block?.type === "output_image").length;
  const files = content.filter((block: any) => block?.type === "input_file" || block?.type === "file").length;
  const textBlocks = content
    .filter((block: any) => typeof block?.text === "string")
    .map((block: any) => block.text as string)
    .filter((text: string) => text.trim() && !/^<\/?(?:image|file)\b/i.test(text.trim()));
  // Multimodal Codex records repeat the human prompt as the longest text block
  // and add paths/tags around image payloads. Keep that semantic prompt once;
  // image/file counts preserve the omitted attachment evidence explicitly.
  const text = images > 0 || files > 0
    ? textBlocks.reduce((longest, candidate) => candidate.length > longest.length ? candidate : longest, "")
    : textBlocks.join("\n");
  return { text, images, files };
}

/** Tool-call arguments as a compact one-liner (parsed when JSON, verbatim otherwise). */
function argsPreview(args: unknown, max = 420): string {
  if (typeof args !== "string") return jsonPreview(args ?? {}, max);
  try { return jsonPreview(JSON.parse(args), max); } catch { return jsonPreview(args, max); }
}

const CODEX_TOOL_CALL_TYPES = new Set(["function_call", "custom_tool_call", "tool_call", "tool_search_call"]);
const CODEX_TOOL_OUTPUT_TYPES = new Set(["function_call_output", "custom_tool_call_output", "tool_result", "tool_output", "tool_search_output"]);

function callId(payload: any): string | undefined {
  return typeof payload?.call_id === "string"
    ? payload.call_id
    : typeof payload?.tool_use_id === "string"
      ? payload.tool_use_id
      : typeof payload?.id === "string"
        ? payload.id
        : undefined;
}

function toolName(payload: any): string {
  return String(payload?.name ?? (payload?.type === "tool_search_call" ? "tool_search" : "(unknown)"));
}

function toolOutputPreview(payload: any, max = 420): string {
  if (payload?.type === "tool_search_output" && Array.isArray(payload.tools)) {
    const names: string[] = [];
    const visit = (value: unknown): void => {
      if (!value || names.length >= 24) return;
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
        return;
      }
      if (typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      if (record.type === "function" && typeof record.name === "string") names.push(record.name);
      if (Array.isArray(record.tools)) visit(record.tools);
    };
    visit(payload.tools);
    return names.length > 0
      ? jsonPreview(`Discovered ${names.length}${names.length >= 24 ? "+" : ""} tools: ${names.join(", ")}`, max)
      : jsonPreview(payload.tools, max);
  }
  const value = payload?.output ?? payload?.result ?? payload?.content ?? payload?.tools ?? "";
  if (Array.isArray(value)) {
    const text = value
      .map((block: any) => typeof block === "string" ? block : typeof block?.text === "string" ? block.text : "")
      .filter(Boolean)
      .join("\n");
    if (text) return jsonPreview(text, max);
  }
  return jsonPreview(value, max);
}

function rawToolOutput(payload: any): string {
  const value = payload?.output ?? payload?.result ?? payload?.content ?? payload?.tools ?? "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function messageFingerprint(text: string): string {
  return `${text.length}:${createHash("sha1").update(text).digest("hex")}`;
}

function codexConversationRecord(obj: any): {
  envelope: "event_msg" | "response_item";
  role: "user" | "assistant";
  text: string;
} | null {
  if (obj?.type === "event_msg") {
    const payload = obj.payload ?? {};
    if (payload.type === "user_message" || payload.type === "agent_message") {
      return {
        envelope: "event_msg",
        role: payload.type === "user_message" ? "user" : "assistant",
        text: typeof payload.message === "string" ? payload.message : "",
      };
    }
  }
  if (obj?.type === "response_item") {
    const payload = obj.payload ?? {};
    if (payload.type === "message" && (payload.role === "user" || payload.role === "assistant")) {
      return {
        envelope: "response_item",
        role: payload.role,
        text: codexMessageProjection(payload).text,
      };
    }
  }
  return null;
}

function suppressCodexMirror(
  obj: any,
  turn: LiveTranscriptTurn,
  recordIndex: number,
  state: TranscriptParseState,
): boolean {
  const message = codexConversationRecord(obj);
  if (!message || turn.role !== message.role) return false;
  const fingerprint = messageFingerprint(message.text);
  const previous = state.lastCodexMessage;
  const mirrored = Boolean(
    previous
    && previous.envelope !== message.envelope
    && previous.role === message.role
    && previous.fingerprint === fingerprint
    && recordIndex - previous.recordIndex <= 3,
  );
  if (!mirrored) {
    state.lastCodexMessage = {
      envelope: message.envelope,
      fingerprint,
      recordIndex,
      role: message.role,
    };
  }
  return mirrored;
}

function toolCallTurn(payload: any, type: string, at: number | undefined, state: TranscriptParseState): LiveTranscriptTurn {
  const id = callId(payload);
  const name = toolName(payload);
  if (id && (state.calls.size < 512 || state.calls.has(id))) state.calls.set(id, { name, at });
  return {
    type,
    subtype: payload.type,
    severity: /error|fail|abort/i.test(String(payload.status ?? "")) ? "error" : "info",
    at,
    role: "tool",
    label: `Tool: ${name}`,
    preview: argsPreview(payload.arguments ?? payload.input),
    tool: {
      ...(id ? { callId: id } : {}),
      name,
      phase: "call",
      ...(typeof payload.status === "string" ? { status: payload.status } : {}),
    },
  };
}

function toolResultTurn(payload: any, type: string, at: number | undefined, state: TranscriptParseState): LiveTranscriptTurn {
  const id = callId(payload);
  const pending = id ? state.calls.get(id) : undefined;
  const name = pending?.name ?? (typeof payload?.name === "string" ? toolName(payload) : "Tool");
  const preview = toolOutputPreview(payload);
  const errored = payload.is_error === true || payload.isError === true
    || /error|fail|abort/i.test(String(payload.status ?? ""))
    || codexToolOutputError(rawToolOutput(payload));
  const durationMs = pending?.at != null && at != null ? Math.max(0, at - pending.at) : undefined;
  if (id) state.calls.delete(id);
  return {
    type,
    subtype: payload.type,
    severity: errored ? "error" : "info",
    at,
    role: "tool",
    label: `${name} result${errored ? " — error" : ""}`,
    preview,
    tool: {
      ...(id ? { callId: id } : {}),
      name,
      phase: "result",
      ...(typeof payload.status === "string" ? { status: payload.status } : {}),
      ...(durationMs != null ? { durationMs } : {}),
    },
  };
}

/**
 * Claude/ncode stores prose, thinking, and one or more tool blocks inside one
 * JSONL record. Expand that compound envelope into semantic viewer turns so
 * each call/result keeps its own ID, name, status, duration, and searchable
 * bounded preview. Raw transcript files remain untouched.
 */
function expandCompoundTranscriptRecord(obj: any, state: TranscriptParseState): LiveTranscriptTurn[] | null {
  const type = String(obj?.type ?? "");
  const content = obj?.message?.content;
  if ((type !== "assistant" && type !== "user") || !Array.isArray(content)) return null;
  const at = parseTimestamp(obj?.timestamp) ?? undefined;
  const blocks = content.filter((block: unknown): block is Record<string, any> => Boolean(block && typeof block === "object"));
  const turns: LiveTranscriptTurn[] = [];

  if (type === "assistant") {
    const thinkingBlocks = blocks.filter((block) => isReasoningTag(block.type));
    if (thinkingBlocks.length > 0) {
      const thinking = thinkingBlocks.map((block) => reasoningTurn(type, "thinking", at, block, "claude", "thinking"));
      turns.push(...thinking);
    }

    const prose = blocks
      .filter((block) => block.type === "text")
      .map((block) => typeof block.text === "string" ? block.text : "")
      .filter(Boolean)
      .join("\n");
    if (prose) {
      turns.push({
        type,
        subtype: "text",
        severity: "info",
        at,
        role: "assistant",
        label: "Assistant",
        preview: jsonPreview(prose),
      });
    }

    for (const block of blocks.filter((candidate) => candidate.type === "tool_use")) {
      turns.push(toolCallTurn(block, type, at, state));
    }
  } else {
    const prose = blocks
      .filter((block) => block.type === "text" || block.type === "input_text")
      .map((block) => typeof block.text === "string" ? block.text : "")
      .filter(Boolean)
      .join("\n");
    if (prose) {
      turns.push({
        type,
        subtype: "text",
        severity: "info",
        at,
        role: "user",
        label: "You",
        preview: jsonPreview(prose),
      });
    }
    for (const block of blocks.filter((candidate) => candidate.type === "tool_result")) {
      turns.push(toolResultTurn(block, type, at, state));
    }
  }

  return turns.length > 0 ? turns : null;
}

function toTranscriptTurn(obj: any, index: number, state: TranscriptParseState): LiveTranscriptTurn {
  const type = typeof obj?.type === "string" ? obj.type : "unknown";
  const subtype = typeof obj?.subtype === "string" ? obj.subtype : undefined;
  const at = parseTimestamp(obj?.timestamp) ?? undefined;

  if (type === "session_meta") {
    const sub = obj.payload?.source?.subagent;
    return {
      type,
      subtype,
      severity: "info",
      at,
      role: "meta",
      label: sub ? `Codex session — subagent ${sub.thread_spawn?.agent_nickname ?? ""}`.trim() : "Codex session",
      preview: jsonPreview({
        id: obj.payload?.id ?? obj.payload?.session_id,
        cwd: obj.payload?.cwd,
        originator: obj.payload?.originator,
        cliVersion: obj.payload?.cli_version,
        modelProvider: obj.payload?.model_provider,
        source: obj.payload?.source,
      }),
    };
  }

  if (type === "event_msg") {
    const payload = obj.payload ?? {};
    if (isReasoningTag(payload.type)) return reasoningTurn(type, payload.type, at, payload, "codex");
    if (payload.type === "agent_message") {
      return { type, subtype: payload.type, severity: "info", at, role: "assistant", label: "Assistant", preview: jsonPreview(payload.message ?? "") };
    }
    if (payload.type === "user_message") {
      return { type, subtype: payload.type, severity: "info", at, role: "user", label: "You", preview: jsonPreview(payload.message ?? "") };
    }
    // Misc events are quiet meta — EXCEPT genuine failure events (error,
    // stream_error, turn_aborted, turn_failed…), which must stay visible and
    // counted in the viewer's warning tally.
    const failureEvent = /error|abort|fail/i.test(String(payload.type ?? ""));
    return {
      type,
      subtype: payload.type,
      severity: failureEvent ? "warning" : "info",
      at,
      role: "meta",
      label: payload.type === "token_count" ? "Usage" : `Event: ${payload.type ?? index}`,
      preview: jsonPreview(payload.type === "token_count" ? payload.info?.total_token_usage ?? payload.info : payload.message ?? payload),
    };
  }

  // Some newer adapters emit a flat reasoning record rather than wrapping it
  // in response_item/item.completed. Normalize it before generic meta output.
  if (isReasoningTag(type) || isReasoningTag(subtype)) {
    return reasoningTurn(type, subtype, at, obj, "generic");
  }

  // New Codex thread/item rollouts use flat lifecycle records instead of the
  // legacy response_item envelope. Keep the viewer faithful to the same
  // user/assistant/tool evidence that the summary parser sees, while still
  // returning bounded previews rather than raw record bodies.
  if (type === "thread.started") {
    return {
      type,
      subtype,
      severity: "info",
      at,
      role: "meta",
      label: "Codex thread",
      preview: jsonPreview({
        id: obj.thread_id ?? obj.session_id,
        cwd: obj.cwd,
        source: obj.source,
        version: obj.cli_version ?? obj.version,
      }),
    };
  }

  if (type === "turn.completed" || type === "turn_complete") {
    const payload = obj.payload ?? obj;
    const failed = payload.is_error === true || payload.isError === true || /error|fail|abort/i.test(String(payload.status ?? ""));
    return {
      type,
      subtype,
      severity: failed ? "error" : "info",
      at,
      role: "meta",
      label: failed ? "Turn completed — error" : "Turn completed",
      preview: jsonPreview({
        status: payload.status,
        stopReason: payload.stop_reason ?? payload.stopReason,
        durationMs: payload.duration_ms ?? payload.durationMs,
      }),
    };
  }

  if (type === "item.completed" || type === "item") {
    const item = obj.item ?? obj.payload ?? {};
    const itemType = String(item.type ?? "");
    const itemAt = parseTimestamp(item.timestamp) ?? at;
    if (itemType === "user_message" || item.role === "user") {
      return { type, subtype: itemType || subtype, severity: "info", at: itemAt, role: "user", label: "You", preview: jsonPreview(item.text ?? contentText(item.content) ?? "") };
    }
    if (itemType === "agent_message" || itemType === "message" || item.role === "assistant") {
      const text = typeof item.text === "string" ? item.text : contentText(item.content);
      return { type, subtype: itemType || subtype, severity: "info", at: itemAt, role: "assistant", label: "Assistant", preview: jsonPreview(text) };
    }
    if (isReasoningTag(itemType)) return reasoningTurn(type, itemType, itemAt, item, "codex");
    if (CODEX_TOOL_CALL_TYPES.has(itemType)) return toolCallTurn(item, type, itemAt, state);
    if (CODEX_TOOL_OUTPUT_TYPES.has(itemType)) return toolResultTurn(item, type, itemAt, state);
    return { type, subtype: itemType || subtype, severity: "info", at: itemAt, role: "meta", label: `Item: ${itemType || "record"}`, preview: jsonPreview(item) };
  }

  if (type === "response_item") {
    const payload = obj.payload ?? {};
    if (payload.type === "message") {
      const role = String(payload.role ?? "");
      const projection = codexMessageProjection(payload);
      const text = projection.text;
      if (role === "assistant") return { type, subtype: "message", severity: "info", at, role: "assistant", label: "Assistant", preview: jsonPreview(text) };
      if (role === "user") return {
        type,
        subtype: "message",
        severity: "info",
        at,
        role: "user",
        label: "You",
        preview: jsonPreview(text),
        ...((projection.images > 0 || projection.files > 0) ? {
          media: {
            ...(projection.images > 0 ? { images: projection.images } : {}),
            ...(projection.files > 0 ? { files: projection.files } : {}),
          },
        } : {}),
      };
      // developer/system prompts are plumbing, not conversation
      return { type, subtype: "message", severity: "info", at, role: "meta", label: `${role || "message"} prompt`, preview: jsonPreview(text) };
    }
    if (CODEX_TOOL_CALL_TYPES.has(payload.type)) return toolCallTurn(payload, type, at, state);
    if (CODEX_TOOL_OUTPUT_TYPES.has(payload.type)) return toolResultTurn(payload, type, at, state);
    if (isReasoningTag(payload.type)) return reasoningTurn(type, payload.type, at, payload, "codex");
    return { type, subtype: payload.type, severity: "info", at, role: "meta", label: `Response: ${payload.type ?? "item"}`, preview: jsonPreview(payload) };
  }

  if (type === "system" && (obj.source_event !== undefined || obj.text !== undefined)) {
    return { type, subtype, severity: "info", at, role: "meta", label: subtype ?? "Source metadata", preview: jsonPreview(obj.source_event ?? obj.text) };
  }
  if (type === "system") {
    const warnings = Number(obj.hookErrors ?? 0) || 0;
    return {
      type,
      subtype,
      severity: warnings > 0 ? "warning" : "info",
      at,
      role: "meta",
      label: subtype ? `System / ${subtype}` : "System event",
      preview: jsonPreview({ cwd: obj.cwd, sessionId: obj.sessionId ?? obj.session_id, stopReason: obj.stopReason, hookErrors: obj.hookErrors, messageCount: obj.messageCount }),
    };
  }

  if (type === "assistant" && Array.isArray(obj.message?.content)) {
    const tools = obj.message.content.filter((b: any) => b.type === "tool_use");
    const text = obj.message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ");
    const thinkingCount = obj.message.content.filter((b: any) => b.type === "thinking").length;
    if (tools.length) {
      const names = tools.map((b: any) => b.name).filter(Boolean);
      // Keep the assistant's prose — a record often carries intent text AND
      // the tool call, and this is the only turn that text appears in.
      const parts = [text, ...tools.map((b: any) => argsPreview(b.input))].filter(Boolean);
      return {
        type, subtype, severity: "info", at, role: "tool",
        label: `Tool: ${names.join(", ") || "(unknown)"}`,
        preview: parts.join("\n"),
      };
    }
    return {
      type,
      subtype,
      severity: "info",
      at,
      role: "assistant",
      label: thinkingCount && !text ? "Thinking" : "Assistant",
      preview: jsonPreview(text || `(${thinkingCount} thinking block${thinkingCount === 1 ? "" : "s"})`),
    };
  }

  if (type === "user" && obj.message) {
    const c = obj.message.content;
    if (typeof c === "string") {
      return { type, subtype, severity: "info", at, role: "user", label: "You", preview: jsonPreview(c) };
    }
    if (Array.isArray(c)) {
      const results = c.filter((b: any) => b.type === "tool_result");
      if (results.length) {
        const errored = results.some((b: any) => b.is_error);
        return {
          type, subtype, severity: errored ? "error" : "info", at, role: "tool",
          label: errored ? "Tool result — error" : "Tool result",
          preview: jsonPreview(results.map((b: any) => contentText(b.content)).join("\n") || results),
        };
      }
      const text = contentText(c);
      if (text) return { type, subtype, severity: "info", at, role: "user", label: "You", preview: jsonPreview(text) };
      return { type, subtype, severity: "info", at, role: "meta", label: "User event", preview: jsonPreview(c) };
    }
  }

  if (type === "result") {
    return {
      type,
      subtype,
      severity: obj.is_error ? "error" : "info",
      at,
      role: "meta",
      label: obj.is_error ? "Final result error" : "Final result",
      preview: jsonPreview({ stopReason: obj.stop_reason, durationMs: obj.duration_ms, numTurns: obj.num_turns, usage: obj.usage, costUsd: obj.total_cost_usd }),
    };
  }

  return {
    type,
    subtype,
    severity: type === "queue-operation" ? "warning" : "info",
    at,
    role: "meta",
    label: `${type || "Trace"} event ${index}`,
    preview: jsonPreview(obj),
  };
}
