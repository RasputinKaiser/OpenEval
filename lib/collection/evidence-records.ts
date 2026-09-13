import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { hermesJsonToRecords } from "../adapters/hermes";
import {
  codexToolOutputError,
  isTruncatedJsonlRecord,
  looksLikeToolError,
  NON_WS_RE,
  parseTimestamp,
  readFileLineRecords,
  TRUNCATED_JSONL_RECORD_PREFIX,
} from "../live/util";

/** Formats that can be normalized without guessing at an encrypted store. */
export type EvidenceInputFormat =
  | "claude-projects"
  | "codex-sessions"
  | "jsonl-dir"
  | "hermes-json"
  | "hermes-sqlite"
  | "ncode"
  | "unknown";

export type EvidenceRecordKind =
  | "request"
  | "constraint"
  | "feedback"
  | "assistant_output"
  | "final_output"
  | "tool_call"
  | "tool_result"
  | "error"
  | "diagnostic";

export type EvidenceRecordStatus = "observed" | "unknown" | "failure";

export interface EvidenceReadOptions {
  /** Stable source identity from the collection catalog. Never a filesystem path. */
  sourceId?: string;
  /** Stable session identity when the caller already has one. */
  sessionId?: string;
  format?: EvidenceInputFormat | string;
  /** Maximum normalized records retained in the packet. */
  maxRecords?: number;
  /** Maximum source bytes inspected. A boundary is reported when exceeded. */
  maxBytes?: number;
  /** Maximum characters retained in an individual excerpt. */
  excerptChars?: number;
}

export interface EvidenceToolRef {
  callId?: string;
  name: string;
  phase: "call" | "result";
}

/**
 * A bounded, browser-safe projection of one source record or compound block.
 * `claimed` is deliberately separate from `observed`: assistant prose may be
 * useful context, but it can never become a tool receipt by itself.
 */
export interface EvidenceRecord {
  evidenceId: string;
  sourceId: string;
  sessionId: string;
  sequence: number;
  sourceRecord: number;
  blockIndex?: number;
  kind: EvidenceRecordKind;
  role: "user" | "assistant" | "tool" | "system" | "meta";
  type: string;
  timestamp: number | null;
  status: EvidenceRecordStatus;
  excerpt: string;
  excerptTruncated: boolean;
  /** Digest of the source payload represented by this bounded record. */
  contentDigest: string;
  tool?: EvidenceToolRef;
  tags: string[];
  observed: boolean;
  claimed?: boolean;
  error?: boolean;
  missingOutput?: boolean;
  unsupported?: boolean;
  truncated?: boolean;
}

export interface EvidenceRecordReadResult {
  records: EvidenceRecord[];
  sourceId: string;
  sessionId: string;
  format: EvidenceInputFormat | "unsupported";
  bytesRead: number;
  sourceRecords: number;
  truncated: boolean;
  unsupported: boolean;
  malformedRecords: number;
  omittedRecords: number;
  /** Digest over every normalized record observed within the byte bound. */
  contentDigest: string;
  warnings: string[];
}

const DEFAULT_MAX_RECORDS = 2_048;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_EXCERPT_CHARS = 420;
const HERMES_MAX_BYTES = 32 * 1024 * 1024;
const DEFAULT_SOURCE_ID = "unknown-source";
const UNKNOWN_SESSION_ID = "unknown-session";

const TOOL_CALL_TYPES = new Set(["function_call", "custom_tool_call", "tool_call", "tool_use", "tool_search_call"]);
const TOOL_RESULT_TYPES = new Set(["function_call_output", "custom_tool_call_output", "tool_result", "tool_output", "tool_search_output"]);
const FAILURE_EVENT_RE = /error|fail|abort|cancel/i;
const GOAL_CHANGE_RE = /\b(?:new|different|another)\s+(?:goal|task|request)\b|\b(?:instead|forget that|change(?:d)?|switch)\b.{0,32}\b(?:goal|task|request|direction)\b/i;
const CONSTRAINT_RE = /\b(?:must|need(?:s)? to|require(?:d)?|only|keep|preserve|do not|don't|without|constraint|acceptance criteria)\b/i;

function digest(value: unknown): string {
  const hash = createHash("sha256");
  if (typeof value === "string") hash.update(value);
  else {
    try { hash.update(JSON.stringify(value)); } catch { hash.update(String(value)); }
  }
  return hash.digest("hex");
}

function excerpt(value: unknown, max: number): { text: string; truncated: boolean } {
  let text = "";
  if (typeof value === "string") text = value;
  else if (value != null) {
    try { text = JSON.stringify(value); } catch { text = String(value); }
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > max
    ? { text: `${text.slice(0, Math.max(0, max - 1))}…`, truncated: true }
    : { text, truncated: false };
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";
  const object = value as Record<string, unknown>;
  if (typeof object.text === "string") return object.text;
  for (const key of ["content", "message", "result", "output", "summary", "reasoning", "thinking"]) {
    const text = textOf(object[key]);
    if (text) return text;
  }
  return "";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function recordType(value: unknown): string {
  return typeof value === "string" && value ? value : "unknown";
}

function payloadOf(obj: Record<string, any>): Record<string, any> {
  return obj.payload && typeof obj.payload === "object" && !Array.isArray(obj.payload) ? obj.payload : obj;
}

function callId(value: Record<string, any>): string | undefined {
  return stringValue(value.call_id) ?? stringValue(value.tool_use_id) ?? stringValue(value.id);
}

function toolName(value: Record<string, any>, fallback = "(unknown)"): string {
  if (typeof value.name === "string" && value.name) return value.name;
  if (value.function && typeof value.function.name === "string" && value.function.name) return value.function.name;
  if (value.type === "tool_search_call") return "tool_search";
  return fallback;
}

function resultValue(value: Record<string, any>): { present: boolean; text: string } {
  for (const key of ["output", "result", "content", "tools"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) return { present: value[key] != null, text: textOf(value[key]) };
  }
  return { present: false, text: "" };
}

function resultFailed(value: Record<string, any>, text: string): boolean {
  return value.is_error === true
    || value.isError === true
    || FAILURE_EVENT_RE.test(String(value.status ?? ""))
    || (text ? codexToolOutputError(text) || looksLikeToolError(text) : false);
}

function resultSucceeded(value: Record<string, any>, text: string): boolean {
  if (resultFailed(value, text)) return false;
  if (value.is_error === false || value.isError === false) return true;
  if (/success|complete|done|passed|succeeded/i.test(String(value.status ?? ""))) return true;
  return /^Exit code:\s*0\b/i.test(text) || /\b\d+\s+pass(?:ed|ing)?\b/i.test(text);
}

function messageText(value: Record<string, any>): string {
  if (typeof value.text === "string") return value.text;
  if (typeof value.message === "string") return value.message;
  return textOf(value.content);
}

interface Candidate {
  kind: EvidenceRecordKind;
  role: EvidenceRecord["role"];
  type: string;
  timestamp: number | null;
  status: EvidenceRecordStatus;
  value: unknown;
  tool?: EvidenceToolRef;
  tags?: string[];
  observed?: boolean;
  claimed?: boolean;
  error?: boolean;
  missingOutput?: boolean;
  unsupported?: boolean;
  truncated?: boolean;
}

interface NormalizeState {
  firstUserSeen: boolean;
  previousMessage?: { envelope: string; role: string; fingerprint: string; sourceRecord: number };
  calls: Map<string, { name: string; sequence: number }>;
}

function timestampOf(obj: Record<string, any>, value: Record<string, any> = obj): number | null {
  return parseTimestamp(obj.timestamp) ?? parseTimestamp(obj.created_at) ?? parseTimestamp(value.timestamp);
}

function textCandidate(
  role: "user" | "assistant",
  text: string,
  type: string,
  at: number | null,
  state: NormalizeState,
): Candidate | null {
  if (!text.trim() || text.trimStart().startsWith("<")) return null;
  const normalized = text.trim();
  if (role === "user") {
    const goalChange = GOAL_CHANGE_RE.test(normalized);
    const first = !state.firstUserSeen;
    state.firstUserSeen = true;
    const feedback = !first;
    return {
      kind: first ? "request" : feedback ? "feedback" : "request",
      role,
      type,
      timestamp: at,
      status: "observed",
      value: normalized,
      tags: [
        ...(first ? ["opening_ask"] : ["later_feedback"]),
        ...(CONSTRAINT_RE.test(normalized) ? ["constraint"] : []),
        ...(goalChange ? ["goal_change"] : []),
      ],
      observed: true,
    };
  }
  return {
    kind: "assistant_output",
    role,
    type,
    timestamp: at,
    status: "observed",
    value: normalized,
    tags: ["assistant_claim"],
    observed: true,
    claimed: true,
  };
}

function toolCallCandidate(value: Record<string, any>, type: string, at: number | null, state: NormalizeState): Candidate {
  const id = callId(value);
  const name = toolName(value);
  if (id) state.calls.set(id, { name, sequence: 0 });
  const args = value.arguments ?? value.input ?? value.function?.arguments ?? {};
  return {
    kind: "tool_call",
    role: "tool",
    type,
    timestamp: at,
    status: "observed",
    value: args,
    tool: { ...(id ? { callId: id } : {}), name, phase: "call" },
    tags: ["tool_receipt"],
    observed: true,
  };
}

function toolResultCandidate(value: Record<string, any>, type: string, at: number | null, state: NormalizeState): Candidate {
  const id = callId(value);
  const pending = id ? state.calls.get(id) : undefined;
  const name = toolName(value, pending?.name ?? "Tool");
  const output = resultValue(value);
  const failed = resultFailed(value, output.text);
  const succeeded = resultSucceeded(value, output.text);
  if (id) state.calls.delete(id);
  return {
    kind: failed ? "error" : "tool_result",
    role: "tool",
    type,
    timestamp: at,
    status: failed ? "failure" : output.present ? "observed" : "unknown",
    value: output.present ? output.text : value,
    tool: { ...(id ? { callId: id } : {}), name, phase: "result" },
    tags: ["tool_receipt", ...(failed ? ["tool_error"] : []), ...(succeeded ? ["tool_success"] : [])],
    observed: output.present || failed,
    error: failed,
    missingOutput: !output.present,
  };
}

function finalCandidate(obj: Record<string, any>, type: string, at: number | null): Candidate {
  const text = messageText(obj) || textOf(obj.result) || textOf(obj.output);
  const failed = obj.is_error === true || obj.isError === true || FAILURE_EVENT_RE.test(String(obj.status ?? obj.stop_reason ?? ""));
  return {
    kind: "final_output",
    role: "meta",
    type,
    timestamp: at,
    status: failed ? "failure" : "observed",
    value: text || { status: obj.status ?? obj.stop_reason ?? "completed" },
    tags: ["completion_receipt", ...(failed ? ["tool_error"] : [])],
    observed: true,
    error: failed,
  };
}

function normalizeObject(obj: Record<string, any>, sourceRecord: number, state: NormalizeState): Candidate[] {
  if (obj.isSidechain === true) return [];
  const type = recordType(obj.type);
  const at = timestampOf(obj);
  const payload = payloadOf(obj);

  if (type === "event_msg") {
    const eventType = recordType(payload.type);
    if (eventType === "user_message") {
      const candidate = textCandidate("user", messageText(payload), eventType, at, state);
      if (candidate) return [candidate];
    }
    if (eventType === "agent_message") {
      const candidate = textCandidate("assistant", messageText(payload), eventType, at, state);
      if (candidate) return [candidate];
    }
    if (FAILURE_EVENT_RE.test(eventType)) {
      return [{ kind: "error", role: "meta", type: eventType, timestamp: at, status: "failure", value: payload.message ?? payload, tags: ["observed_error"], observed: true, error: true }];
    }
    return [];
  }

  if (type === "response_item") {
    return normalizeEnvelope(payload, type, at, state);
  }

  if (type === "item" || type === "item.completed") {
    return normalizeEnvelope(obj.item && typeof obj.item === "object" ? obj.item : payload, type, at, state);
  }

  if (type === "assistant" || type === "user") {
    const content = obj.message?.content ?? obj.content;
    if (Array.isArray(content)) {
      const out: Candidate[] = [];
      for (const [index, block] of content.entries()) {
        if (!block || typeof block !== "object") continue;
        const item = block as Record<string, any>;
        const blockType = recordType(item.type);
        if (type === "assistant" && blockType === "tool_use") out.push(toolCallCandidate(item, type, at, state));
        else if (type === "user" && blockType === "tool_result") out.push(toolResultCandidate(item, type, at, state));
        else if (blockType === "text" || blockType === "input_text") {
          const candidate = textCandidate(type === "user" ? "user" : "assistant", String(item.text ?? ""), type, at, state);
          if (candidate) out.push(candidate);
        }
        // Preserve compound block identity in a stable digest without emitting
        // the block index as user-facing content; it is attached later.
        void index;
      }
      return out;
    }
    const candidate = textCandidate(type === "user" ? "user" : "assistant", messageText(obj.message ?? obj), type, at, state);
    return candidate ? [candidate] : [];
  }

  if (type === "result" || type === "turn.completed" || type === "turn_complete") return [finalCandidate(type === "result" ? obj : payload, type, at)];

  if (obj.role === "user" || obj.role === "assistant") {
    const candidate = textCandidate(obj.role, messageText(obj), type, at, state);
    const out = candidate ? [candidate] : [];
    if (obj.role === "assistant" && Array.isArray(obj.tool_calls)) {
      for (const call of obj.tool_calls) if (call && typeof call === "object") out.push(toolCallCandidate(call as Record<string, any>, type, at, state));
    }
    return out;
  }
  if (obj.role === "tool") return [toolResultCandidate(obj, type, at, state)];
  if (TOOL_CALL_TYPES.has(type)) return [toolCallCandidate(payload, type, at, state)];
  if (TOOL_RESULT_TYPES.has(type)) return [toolResultCandidate(payload, type, at, state)];
  if (FAILURE_EVENT_RE.test(type) && (obj.error != null || obj.message != null || obj.status != null)) {
    return [{ kind: "error", role: "meta", type, timestamp: at, status: "failure", value: obj.message ?? obj.error ?? obj, tags: ["observed_error"], observed: true, error: true }];
  }
  // Routine metadata is intentionally omitted; an unknown payload is retained
  // as a diagnostic so unsupported shapes cannot look like a clean transcript.
  if (type === "system" || type === "session_meta" || type === "thread.started" || type === "reasoning" || type === "token_count" || type === "queue-operation") return [];
  return [{ kind: "diagnostic", role: "meta", type, timestamp: at, status: "unknown", value: obj, tags: ["unsupported"], observed: false, unsupported: true }];
}

function normalizeEnvelope(value: Record<string, any>, type: string, at: number | null, state: NormalizeState): Candidate[] {
  const nestedType = recordType(value.type);
  if (TOOL_CALL_TYPES.has(nestedType)) return [toolCallCandidate(value, nestedType, at, state)];
  if (TOOL_RESULT_TYPES.has(nestedType)) return [toolResultCandidate(value, nestedType, at, state)];
  if (nestedType === "message" || value.role === "user" || value.role === "assistant") {
    const role = value.role === "user" ? "user" : value.role === "assistant" ? "assistant" : null;
    if (!role) return [];
    const text = messageText(value);
    const fingerprint = digest(`${role}\0${text}`);
    const mirrored = state.previousMessage
      && state.previousMessage.role === role
      && state.previousMessage.fingerprint === fingerprint
      && state.previousMessage.envelope !== type
      && sourceRecordDistance(state.previousMessage.sourceRecord, 1) <= 3;
    state.previousMessage = { envelope: type, role, fingerprint, sourceRecord: 0 };
    if (mirrored) return [];
    const out: Candidate[] = [];
    const candidate = textCandidate(role, text, nestedType || type, at, state);
    if (candidate) out.push(candidate);
    if (role === "assistant" && Array.isArray(value.tool_calls)) {
      for (const call of value.tool_calls) if (call && typeof call === "object") out.push(toolCallCandidate(call as Record<string, any>, nestedType || type, at, state));
    }
    return out;
  }
  return [];
}

function sourceRecordDistance(previous: number, current: number): number {
  // `normalizeEnvelope` does not need the exact line number for mirror
  // suppression. Keeping this helper explicit documents the bounded window.
  return Math.abs(current - previous);
}

function stableSessionId(file: string, options: EvidenceReadOptions): string {
  if (options.sessionId?.trim()) return options.sessionId.trim();
  const basename = path.basename(file).replace(/\.[^.]+$/, "");
  return basename || UNKNOWN_SESSION_ID;
}

function normalizedFormat(file: string, format?: string): EvidenceInputFormat | "unsupported" {
  if (format === "hermes-sqlite" || path.extname(file).toLowerCase() === ".db") return "unsupported";
  if (format === "hermes-json" || path.extname(file).toLowerCase() === ".json") return "hermes-json";
  if (format === "claude-projects" || format === "codex-sessions" || format === "jsonl-dir" || format === "ncode") return format;
  if (!format || format === "unknown") return "jsonl-dir";
  return "unsupported";
}

function makeRecord(candidate: Candidate, rawValue: unknown, sourceId: string, sessionId: string, sourceRecord: number, sequence: number, blockIndex: number | undefined, maxExcerpt: number): EvidenceRecord {
  const rawDigest = digest(rawValue);
  const value = excerpt(candidate.value, maxExcerpt);
  const tags = [...new Set(candidate.tags ?? [])];
  const evidenceId = `ev_${digest(`${sourceId}\0${sessionId}\0${sourceRecord}\0${blockIndex ?? 0}\0${candidate.kind}\0${candidate.tool?.callId ?? ""}\0${rawDigest}`).slice(0, 24)}`;
  return {
    evidenceId,
    sourceId,
    sessionId,
    sequence,
    sourceRecord,
    ...(blockIndex == null ? {} : { blockIndex }),
    kind: candidate.kind,
    role: candidate.role,
    type: candidate.type,
    timestamp: candidate.timestamp,
    status: candidate.status,
    excerpt: value.text,
    excerptTruncated: value.truncated,
    contentDigest: rawDigest,
    ...(candidate.tool ? { tool: candidate.tool } : {}),
    tags,
    observed: candidate.observed ?? false,
    ...(candidate.claimed ? { claimed: true } : {}),
    ...(candidate.error ? { error: true } : {}),
    ...(candidate.missingOutput ? { missingOutput: true, tags: [...new Set([...tags, "missing_output"])] } : {}),
    ...(candidate.unsupported ? { unsupported: true } : {}),
    ...(candidate.truncated ? { truncated: true } : {}),
  };
}

function diagnosticRecord(
  message: string,
  candidate: Pick<Candidate, "kind" | "type" | "status" | "unsupported" | "truncated">,
  sourceId: string,
  sessionId: string,
  sourceRecord: number,
  sequence: number,
  maxExcerpt: number,
): EvidenceRecord {
  return makeRecord({
    ...candidate,
    role: "meta",
    timestamp: null,
    value: message,
    tags: [candidate.unsupported ? "unsupported" : candidate.truncated ? "truncated" : "malformed"],
    observed: false,
  }, message, sourceId, sessionId, sourceRecord, sequence, undefined, maxExcerpt);
}

function* normalizeLines(
  lines: Iterable<{ line: string; nextOffset?: number } | string>,
  options: Required<Pick<EvidenceReadOptions, "sourceId" | "sessionId" | "maxRecords" | "maxBytes" | "excerptChars">>,
): Generator<EvidenceRecord> {
  const state: NormalizeState = { firstUserSeen: false, calls: new Map() };
  let sequence = 0;
  let sourceRecord = 0;
  let bytesRead = 0;
  for (const entry of lines) {
    const line = typeof entry === "string" ? entry : entry.line;
    const nextOffset = typeof entry === "string" ? bytesRead + Buffer.byteLength(line) : entry.nextOffset ?? bytesRead + Buffer.byteLength(line);
    bytesRead = nextOffset;
    sourceRecord++;
    if (sequence >= options.maxRecords) return;
    if (options.maxBytes > 0 && bytesRead > options.maxBytes) {
      yield diagnosticRecord(`Evidence read stopped at the ${options.maxBytes}-byte bound.`, { kind: "diagnostic", type: "bounded_read", status: "unknown", truncated: true }, options.sourceId, options.sessionId, sourceRecord, sequence++, options.excerptChars);
      return;
    }
    if (!NON_WS_RE.test(line)) continue;
    if (isTruncatedJsonlRecord(line)) {
      yield diagnosticRecord(line.slice(TRUNCATED_JSONL_RECORD_PREFIX.length), { kind: "diagnostic", type: "truncated_record", status: "unknown", truncated: true }, options.sourceId, options.sessionId, sourceRecord, sequence++, options.excerptChars);
      continue;
    }
    let obj: unknown;
    try { obj = JSON.parse(line); } catch {
      yield diagnosticRecord(line, { kind: "diagnostic", type: "malformed_record", status: "unknown" }, options.sourceId, options.sessionId, sourceRecord, sequence++, options.excerptChars);
      continue;
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      yield diagnosticRecord(line, { kind: "diagnostic", type: "unsupported_record", status: "unknown", unsupported: true }, options.sourceId, options.sessionId, sourceRecord, sequence++, options.excerptChars);
      continue;
    }
    const candidates = normalizeObject(obj as Record<string, any>, sourceRecord, state);
    for (const [blockIndex, candidate] of candidates.entries()) {
      if (sequence >= options.maxRecords) return;
      yield makeRecord(candidate, candidate.value, options.sourceId, options.sessionId, sourceRecord, sequence++, candidates.length > 1 ? blockIndex : undefined, options.excerptChars);
    }
  }
}

function readBoundedText(file: string, maxBytes: number): { text: string; bytesRead: number; exceeded: boolean } {
  const fd = fs.openSync(file, "r");
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    const chunkSize = 1 << 20;
    const buffer = Buffer.allocUnsafe(chunkSize);
    let n = 0;
    while (total <= maxBytes && (n = fs.readSync(fd, buffer, 0, chunkSize, total)) > 0) {
      const remaining = maxBytes + 1 - total;
      const take = Math.min(n, Math.max(0, remaining));
      if (take > 0) chunks.push(Buffer.from(buffer.subarray(0, take)));
      total += n;
      if (total > maxBytes) break;
    }
  } finally { fs.closeSync(fd); }
  const bytesRead = Math.min(total, maxBytes + 1);
  return { text: Buffer.concat(chunks).toString("utf8"), bytesRead, exceeded: total > maxBytes };
}

function sourceIdentityFromText(raw: string, fallback: string): string {
  try {
    const obj = JSON.parse(raw) as Record<string, any>;
    return stringValue(obj.session_id) ?? stringValue(obj.sessionId) ?? fallback;
  } catch { return fallback; }
}

function inferJsonlSessionId(file: string, fallback: string, headBytes: number): string {
  try {
    let inspected = 0;
    for (const entry of readFileLineRecords(file)) {
      inspected = entry.nextOffset;
      if (inspected > headBytes) break;
      try {
        const obj = JSON.parse(entry.line) as Record<string, any>;
        const payload = obj.payload && typeof obj.payload === "object" ? obj.payload : {};
        const nested = obj.session_meta && typeof obj.session_meta === "object" ? obj.session_meta : {};
        const id = stringValue(obj.session_id)
          ?? stringValue(obj.sessionId)
          ?? stringValue(obj.thread_id)
          ?? stringValue(payload.session_id)
          ?? stringValue(payload.sessionId)
          ?? stringValue(payload.id)
          ?? stringValue(nested.session_id)
          ?? stringValue(nested.id);
        if (id) return id;
      } catch {}
    }
  } catch {}
  return fallback;
}

/** Stream normalized evidence records from JSONL or a bounded Hermes document. */
export function* readEvidenceRecords(file: string, options: EvidenceReadOptions = {}): Generator<EvidenceRecord> {
  const sourceId = options.sourceId?.trim() || DEFAULT_SOURCE_ID;
  const maxRecords = Math.max(1, Math.floor(options.maxRecords ?? DEFAULT_MAX_RECORDS));
  const maxBytes = Math.max(1, Math.floor(options.maxBytes ?? DEFAULT_MAX_BYTES));
  const excerptChars = Math.max(40, Math.floor(options.excerptChars ?? DEFAULT_EXCERPT_CHARS));
  const format = normalizedFormat(file, options.format);
  const fallbackSessionId = stableSessionId(file, options);
  if (format === "unsupported") {
    const formatLabel = (options.format ?? path.extname(file)) || "unknown";
    yield diagnosticRecord(`Unsupported evidence source format: ${formatLabel}.`, { kind: "diagnostic", type: "unsupported_format", status: "unknown", unsupported: true }, sourceId, fallbackSessionId, 0, 0, excerptChars);
    return;
  }
  if (format === "hermes-json") {
    let stat: fs.Stats;
    try { stat = fs.statSync(file); } catch {
      yield diagnosticRecord("Evidence source disappeared before it could be read.", { kind: "diagnostic", type: "missing_source", status: "unknown", unsupported: true }, sourceId, fallbackSessionId, 0, 0, excerptChars);
      return;
    }
    const bounded = readBoundedText(file, Math.min(maxBytes, HERMES_MAX_BYTES));
    if (bounded.exceeded || stat.size > Math.min(maxBytes, HERMES_MAX_BYTES)) {
      yield diagnosticRecord(`Hermes evidence exceeded the ${Math.min(maxBytes, HERMES_MAX_BYTES)}-byte bound.`, { kind: "diagnostic", type: "truncated_source", status: "unknown", truncated: true }, sourceId, fallbackSessionId, 0, 0, excerptChars);
      return;
    }
    const records = hermesJsonToRecords(bounded.text);
    if (records.length === 0) {
      yield diagnosticRecord("JSON source is not a supported Hermes session document.", { kind: "diagnostic", type: "unsupported_format", status: "unknown", unsupported: true }, sourceId, sourceIdentityFromText(bounded.text, fallbackSessionId), 0, 0, excerptChars);
      return;
    }
    yield* normalizeLines(records, { sourceId, sessionId: sourceIdentityFromText(bounded.text, fallbackSessionId), maxRecords, maxBytes, excerptChars });
    return;
  }
  const stat = fs.statSync(file);
  const sessionId = options.sessionId?.trim() || inferJsonlSessionId(file, fallbackSessionId, Math.min(maxBytes, 64 * 1024));
  yield* normalizeLines(readFileLineRecords(file), { sourceId, sessionId, maxRecords, maxBytes: Math.min(maxBytes, stat.size + 1), excerptChars });
}

/** Parse an in-memory record stream using the same normalizer as file reads. */
export function readEvidenceRecordsFromLines(lines: Iterable<string>, options: EvidenceReadOptions = {}): EvidenceRecord[] {
  const sourceId = options.sourceId?.trim() || DEFAULT_SOURCE_ID;
  const sessionId = options.sessionId?.trim() || UNKNOWN_SESSION_ID;
  const maxRecords = Math.max(1, Math.floor(options.maxRecords ?? DEFAULT_MAX_RECORDS));
  const maxBytes = Math.max(1, Math.floor(options.maxBytes ?? DEFAULT_MAX_BYTES));
  const excerptChars = Math.max(40, Math.floor(options.excerptChars ?? DEFAULT_EXCERPT_CHARS));
  return [...normalizeLines(lines, { sourceId, sessionId, maxRecords, maxBytes, excerptChars })];
}

function safeDiagnostic(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  // Client-facing evidence may not carry the source path. Keep the error kind
  // and redact Unix/Windows path-shaped substrings from parser/fs failures.
  return text
    .replace(/(?:[A-Za-z]:[\\/]|\/)[^\s"'`:)]+/g, "[source]")
    .slice(0, DEFAULT_EXCERPT_CHARS);
}

function isCriticalRecord(record: EvidenceRecord): boolean {
  if (record.kind === "error" || record.kind === "final_output") return true;
  if (record.tags.some((tag) => ["goal_change", "missing_output", "truncated", "unsupported", "observed_error"].includes(tag))) return true;
  return record.kind === "tool_result" && (record.tags.includes("tool_success") || /(?:exit\s*code\s*:\s*0|\bpassed\b|\bsucceeded\b)/i.test(record.excerpt));
}

interface RetainedEvidenceScan {
  records: EvidenceRecord[];
  totalRecords: number;
  omittedRecords: number;
  sawTruncated: boolean;
  sawUnsupported: boolean;
  malformedRecords: number;
  contentDigest: string;
}

function retainBoundedRecords(stream: Iterable<EvidenceRecord>, maxRecords: number): RetainedEvidenceScan {
  // Keep a small opening reservation while leaving room for the tail/failure
  // evidence that a long session often contains after the initial ask.
  const openingCap = Math.min(64, Math.max(1, maxRecords - 2));
  const opening: EvidenceRecord[] = [];
  const critical: EvidenceRecord[] = [];
  const recent: EvidenceRecord[] = [];
  let totalRecords = 0;
  let sawTruncated = false;
  let sawUnsupported = false;
  let malformedRecords = 0;
  const contentHash = createHash("sha256");
  for (const record of stream) {
    totalRecords++;
    contentHash.update(`${record.sourceRecord}:${record.blockIndex ?? 0}:${record.contentDigest}\n`);
    sawTruncated ||= Boolean(record.truncated);
    sawUnsupported ||= Boolean(record.unsupported);
    if (record.type === "malformed_record") malformedRecords++;
    if (opening.length < openingCap) opening.push(record);
    if (isCriticalRecord(record)) {
      critical.push(record);
      if (critical.length > maxRecords) critical.shift();
    }
    recent.push(record);
    if (recent.length > maxRecords) recent.shift();
  }
  const selected = new Map<string, EvidenceRecord>();
  const add = (record: EvidenceRecord) => { if (selected.size < maxRecords) selected.set(record.evidenceId, record); };
  for (const record of opening) add(record);
  const prioritizedCritical = [...critical].sort((a, b) => {
    const rank = (record: EvidenceRecord): number => record.kind === "error" || record.kind === "final_output" || record.tags.includes("goal_change") ? 0 : 1;
    return rank(a) - rank(b) || b.sequence - a.sequence;
  });
  for (const record of prioritizedCritical) add(record);
  for (const record of recent) add(record);
  const records = [...selected.values()].sort((a, b) => a.sequence - b.sequence);
  return { records, totalRecords, omittedRecords: Math.max(0, totalRecords - records.length), sawTruncated, sawUnsupported, malformedRecords, contentDigest: contentHash.digest("hex") };
}

/** Build bounded read metadata while retaining opening, critical, and recent evidence. */
export function collectEvidenceRecords(file: string, options: EvidenceReadOptions = {}): EvidenceRecordReadResult {
  const sourceId = options.sourceId?.trim() || DEFAULT_SOURCE_ID;
  const fallbackSessionId = options.sessionId?.trim() || stableSessionId(file, options);
  const maxRecords = Math.max(1, Math.floor(options.maxRecords ?? DEFAULT_MAX_RECORDS));
  const maxBytes = Math.max(1, Math.floor(options.maxBytes ?? DEFAULT_MAX_BYTES));
  const format = normalizedFormat(file, options.format);
  let scan: RetainedEvidenceScan;
  try {
    // The low-level reader still bounds bytes and each JSONL line. Retention is
    // performed here so a long session keeps its opening ask and recent/failure
    // evidence instead of silently slicing away the tail.
    scan = retainBoundedRecords(readEvidenceRecords(file, { ...options, sourceId, maxRecords: Number.MAX_SAFE_INTEGER, maxBytes }), maxRecords);
  }
  catch (error) {
    const diagnostic = diagnosticRecord(safeDiagnostic(error), { kind: "diagnostic", type: "read_error", status: "unknown", unsupported: true }, sourceId, fallbackSessionId, 0, 0, options.excerptChars ?? DEFAULT_EXCERPT_CHARS);
    scan = { records: [diagnostic], totalRecords: 1, omittedRecords: 0, sawTruncated: false, sawUnsupported: true, malformedRecords: 0, contentDigest: digest(diagnostic.contentDigest) };
  }
  const records = scan.records;
  const omittedRecords = scan.omittedRecords;
  const truncated = scan.sawTruncated || omittedRecords > 0;
  const unsupported = format === "unsupported" || scan.sawUnsupported;
  const malformedRecords = scan.malformedRecords;
  const bytesRead = (() => { try { return Math.min(fs.statSync(file).size, maxBytes); } catch { return 0; } })();
  const sessionId = options.sessionId?.trim() || records.find((record) => record.sessionId && record.sessionId !== UNKNOWN_SESSION_ID)?.sessionId || fallbackSessionId;
  const warnings: string[] = [];
  if (truncated) warnings.push("Evidence packet is bounded; additional source records may be omitted.");
  if (unsupported) warnings.push("Some source records or the source format were unsupported; sufficiency remains explicit.");
  if (malformedRecords > 0) warnings.push(`${malformedRecords} malformed source record${malformedRecords === 1 ? "" : "s"} were retained as unknown diagnostics.`);
  return {
    records,
    sourceId,
    sessionId,
    format: format === "unsupported" ? "unsupported" : format,
    bytesRead,
    sourceRecords: scan.totalRecords,
    truncated,
    unsupported,
    malformedRecords,
    omittedRecords,
    contentDigest: scan.contentDigest,
    warnings: [...warnings, `contentDigest:${scan.contentDigest}`],
  };
}
