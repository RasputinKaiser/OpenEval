import { createHash } from "node:crypto";
import {
  collectEvidenceRecords,
  type EvidenceInputFormat,
  type EvidenceReadOptions,
  type EvidenceRecord,
} from "../collection/evidence-records";

export type { EvidenceInputFormat, EvidenceReadOptions, EvidenceRecord, EvidenceRecordKind, EvidenceRecordStatus } from "../collection/evidence-records";
export { collectEvidenceRecords, readEvidenceRecords, readEvidenceRecordsFromLines } from "../collection/evidence-records";

export type EvidenceDimensionStatus = "pass" | "fail" | "mixed" | "unknown";
export type EvidenceSufficiency = "sufficient" | "insufficient" | "unknown";

export interface EvidenceDimension {
  /** A status of unknown means the source did not contain enough proof. */
  status: EvidenceDimensionStatus;
  /** Explicit alias for consumers that render observed versus unknown proof. */
  state: "observed" | "unknown";
  outcome: string;
  evidenceIds: string[];
  summary: string;
}

export interface EvidenceEpisode {
  episodeId: string;
  sourceId: string;
  sessionId: string;
  startEvidenceId: string;
  endEvidenceId: string;
  /** Explicit means a goal-change marker was observed; uncertain is conservative. */
  boundary: "explicit" | "uncertain";
  boundaryReason: string;
  openingAskEvidenceId?: string;
  constraintEvidenceIds: string[];
  evidenceIds: string[];
}

export interface EvidenceFeedback {
  evidenceId: string;
  episodeId?: string;
  sentiment: "positive" | "negative" | "neutral";
  excerpt: string;
}

export interface EvidencePacketBounds {
  maxRecords: number;
  maxBytes: number;
  excerptChars: number;
  recordsRetained: number;
  sourceRecords: number;
  bytesRead: number;
  truncated: boolean;
  unsupported: boolean;
  malformedRecords: number;
  omittedRecords: number;
  warnings: string[];
}

export interface EvidenceEvaluation {
  completionEvidence: EvidenceDimension;
  verification: EvidenceDimension;
  recovery: EvidenceDimension;
  unresolvedIssues: EvidenceDimension;
  sufficiency: EvidenceSufficiency;
  /** Evidence ids used by the evaluator, useful for a detail drawer. */
  observedEvidenceIds: string[];
  /** Assistant claims are surfaced separately and never enter observed proof. */
  ignoredClaimEvidenceIds: string[];
}

export interface EvidencePacket {
  version: "evidence-packet.v1";
  sourceId: string;
  sessionId: string;
  format: EvidenceInputFormat | "unsupported";
  /** Digest of the normalized retained evidence, independent of filesystem paths. */
  contentDigest: string;
  records: EvidenceRecord[];
  episodes: EvidenceEpisode[];
  feedback: EvidenceFeedback[];
  openingAskEvidenceId?: string;
  constraintEvidenceIds: string[];
  finalOutputEvidenceId?: string;
  bounds: EvidencePacketBounds;
  evaluation: EvidenceEvaluation;
}

export interface BuildEvidencePacketOptions extends EvidenceReadOptions {
  /** Maximum number of episodes retained after normalization. */
  maxEpisodes?: number;
}

const DEFAULT_MAX_RECORDS = 2_048;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_EXCERPT_CHARS = 420;
const GOAL_CHANGE_RE = /\b(?:new|different|another)\s+(?:goal|task|request)\b|\b(?:instead|forget that|change(?:d)?|switch)\b.{0,32}\b(?:goal|task|request|direction)\b/i;
const VERIFICATION_COMMAND_RE = /(?:^|[\s"'=/:])(?:pytest|vitest|jest|mocha|node\s+--test|npm\s+(?:run\s+)?(?:test|lint|typecheck|build)|pnpm\s+(?:run\s+)?(?:test|lint|typecheck|build)|yarn\s+(?:test|lint|typecheck|build)|cargo\s+test|go\s+test|swift\s+test|mix\s+test|mvn\s+test|gradle\s+test|tsc(?:\.exe)?|eslint(?:\.js)?|ruff|mypy|shellcheck|(?:verify|verification|typecheck|lint|build|compile|validate)(?:\b|[-_]))/i;
const POSITIVE_RE = /\b(?:thanks?|thank you|perfect|great|awesome|nice|excellent|love it|lgtm|works?|correct|ship it|exactly)\b/i;
const NEGATIVE_RE = /\b(?:still|wrong|incorrect|not right|broken|fail(?:ed|ing)?|doesn'?t work|nope|revert|undo|rollback)\b/i;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function dimension(status: EvidenceDimensionStatus, outcome: string, evidenceIds: string[], summary: string): EvidenceDimension {
  return {
    status,
    state: status === "unknown" ? "unknown" : "observed",
    outcome,
    evidenceIds: [...new Set(evidenceIds)],
    summary,
  };
}

function recordIsToolResult(record: EvidenceRecord): boolean {
  return record.kind === "tool_result" || (record.kind === "error" && record.tool?.phase === "result");
}

function recordIsToolCall(record: EvidenceRecord): boolean {
  return record.kind === "tool_call" && record.tool?.phase === "call";
}

function recordIsSuccess(record: EvidenceRecord): boolean {
  return recordIsToolResult(record) && record.status === "observed" && record.error !== true && record.missingOutput !== true;
}

function recordIsFailure(record: EvidenceRecord): boolean {
  return record.error === true || record.status === "failure";
}

function normalizedToolIdentity(record: EvidenceRecord, calls: Map<string, EvidenceRecord>): string {
  const call = record.tool?.phase === "call"
    ? record
    : record.tool?.callId
      ? calls.get(record.tool.callId)
      : undefined;
  if (!call?.tool) return "";
  let args = call.excerpt.trim();
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    const command = parsed.cmd ?? parsed.command ?? parsed.arguments ?? parsed.input ?? parsed;
    args = typeof command === "string" ? command : JSON.stringify(command);
  } catch { /* compact non-JSON arguments remain a deterministic identity */ }
  return `${call.tool.name.trim().toLowerCase()}|${args.replace(/\s+/g, " ").trim()}`;
}

function episodeForRecord(record: EvidenceRecord, records: EvidenceRecord[]): number {
  let episode = 0;
  for (const candidate of records) {
    if (candidate.sequence >= record.sequence) break;
    if (candidate.role === "user" && isGoalChange(candidate)) episode++;
  }
  return episode;
}

function isVerificationRecord(record: EvidenceRecord, calls: Map<string, EvidenceRecord>): boolean {
  if (!recordIsToolResult(record)) return false;
  const call = record.tool?.callId ? calls.get(record.tool.callId) : undefined;
  if (!call) return false;
  // The command identity, rather than arbitrary output prose, determines
  // whether a receipt is a verification attempt. This avoids treating source
  // code that merely mentions "tests" as a test result.
  return VERIFICATION_COMMAND_RE.test(`${call.tool?.name ?? ""} ${call.excerpt}`);
}

function isSuccessfulVerification(record: EvidenceRecord): boolean {
  return recordIsSuccess(record) && (
    /^Exit code:\s*0\b/i.test(record.excerpt)
    || /\b(?:passed|passing|succeeded)\b/i.test(record.excerpt)
    || /\b0\s+(?:errors?|failures?)\b/i.test(record.excerpt)
  );
}

function isGoalChange(record: EvidenceRecord): boolean {
  return record.tags.includes("goal_change") || GOAL_CHANGE_RE.test(record.excerpt);
}

function feedbackSentiment(record: EvidenceRecord): EvidenceFeedback["sentiment"] {
  if (NEGATIVE_RE.test(record.excerpt)) return "negative";
  if (POSITIVE_RE.test(record.excerpt)) return "positive";
  return "neutral";
}

function buildEpisodes(records: EvidenceRecord[], maxEpisodes: number): { episodes: EvidenceEpisode[]; feedback: EvidenceFeedback[]; openingAskEvidenceId?: string; constraintEvidenceIds: string[]; finalOutputEvidenceId?: string } {
  const episodes: EvidenceEpisode[] = [];
  const feedback: EvidenceFeedback[] = [];
  const constraintEvidenceIds = records.filter((record) => record.tags.includes("constraint") || record.kind === "constraint").map((record) => record.evidenceId);
  const opening = records.find((record) => record.tags.includes("opening_ask") || record.kind === "request");
  let current: EvidenceEpisode | undefined;

  const closeCurrent = (end: EvidenceRecord) => {
    if (!current) return;
    current.endEvidenceId = end.evidenceId;
    if (!current.evidenceIds.includes(end.evidenceId)) current.evidenceIds.push(end.evidenceId);
  };
  const startEpisode = (record: EvidenceRecord, boundary: "explicit" | "uncertain", reason: string) => {
    if (episodes.length >= maxEpisodes) return;
    const episodeId = `episode_${digest(`${record.sourceId}\0${record.sessionId}\0${record.evidenceId}`).slice(0, 20)}`;
    current = {
      episodeId,
      sourceId: record.sourceId,
      sessionId: record.sessionId,
      startEvidenceId: record.evidenceId,
      endEvidenceId: record.evidenceId,
      boundary,
      boundaryReason: reason,
      ...(record.kind === "request" || record.tags.includes("opening_ask") ? { openingAskEvidenceId: record.evidenceId } : {}),
      constraintEvidenceIds: [],
      evidenceIds: [record.evidenceId],
    };
    episodes.push(current);
  };

  for (const record of records) {
    if (!current && record.role !== "meta") startEpisode(record, record.kind === "request" ? "explicit" : "uncertain", record.kind === "request" ? "opening user request" : "no explicit opening request was retained");
    if (record.role === "user" && isGoalChange(record) && current && current.startEvidenceId !== record.evidenceId) {
      closeCurrent(records[Math.max(0, record.sequence - 1)] ?? record);
      startEpisode(record, "explicit", "user message explicitly changes the goal or direction");
    } else if (current && !current.evidenceIds.includes(record.evidenceId)) {
      current.evidenceIds.push(record.evidenceId);
      current.endEvidenceId = record.evidenceId;
    }
    if (current && constraintEvidenceIds.includes(record.evidenceId)) current.constraintEvidenceIds.push(record.evidenceId);
    if (record.kind === "feedback") feedback.push({ evidenceId: record.evidenceId, episodeId: current?.episodeId, sentiment: feedbackSentiment(record), excerpt: record.excerpt });
  }

  const lastAssistant = [...records].reverse().find((record) => record.kind === "assistant_output");
  const explicitFinal = [...records].reverse().find((record) => record.kind === "final_output" && record.claimed !== true);
  return {
    episodes,
    feedback,
    ...(opening ? { openingAskEvidenceId: opening.evidenceId } : {}),
    constraintEvidenceIds: [...new Set(constraintEvidenceIds)],
    ...((explicitFinal ?? lastAssistant) ? { finalOutputEvidenceId: (explicitFinal ?? lastAssistant)!.evidenceId } : {}),
  };
}

/**
 * Evaluate only source-observed receipts. Assistant prose remains available in
 * the packet but is placed in `ignoredClaimEvidenceIds` and never proves a
 * completion or verification dimension.
 */
export function evaluateEvidencePacket(input: EvidencePacket | EvidenceRecord[], meta: { truncated?: boolean; unsupported?: boolean } = {}): EvidenceEvaluation {
  const records = Array.isArray(input) ? input : input.records;
  const truncated = Array.isArray(input) ? Boolean(meta.truncated) : input.bounds.truncated;
  const unsupported = Array.isArray(input) ? Boolean(meta.unsupported) : input.bounds.unsupported;
  const calls = new Map<string, EvidenceRecord>();
  const toolResults = records.filter(recordIsToolResult);
  const failures = records.filter(recordIsFailure);
  for (const record of records) if (recordIsToolCall(record) && record.tool?.callId) calls.set(record.tool.callId, record);
  const observedEvidenceIds = records.filter((record) => record.observed && record.claimed !== true && (record.kind === "tool_call" || recordIsToolResult(record) || record.kind === "final_output" || record.kind === "error")).map((record) => record.evidenceId);
  const ignoredClaimEvidenceIds = records.filter((record) => record.claimed === true).map((record) => record.evidenceId);

  const completionReceipts = records.filter((record) => record.kind === "final_output" && record.claimed !== true);
  const completionSuccess = completionReceipts.filter((record) => record.status === "observed" && !record.error);
  const completionFailures = completionReceipts.filter((record) => record.status === "failure" || record.error);
  // A turn/result receipt is transport evidence only. It proves that the
  // harness ended a turn, never that the user's goal was achieved.
  const completionEvidence = completionSuccess.length > 0
    ? dimension("unknown", "transport completion observed; goal unknown", completionSuccess.map((record) => record.evidenceId), "A source record reports a completed turn/result; no goal-completion claim is inferred.")
    : completionFailures.length > 0
      ? dimension("unknown", "transport failure observed; goal unknown", completionFailures.map((record) => record.evidenceId), "A source record reports an errored or aborted turn; goal completion remains unknown.")
      : dimension("unknown", "no observed completion receipt", [], "The transcript contains no source-observed completion receipt.");

  const verificationRecords = toolResults.filter((record) => isVerificationRecord(record, calls));
  const verificationPass = verificationRecords.filter(isSuccessfulVerification);
  const verificationFail = verificationRecords.filter(recordIsFailure);
  const verification = verificationPass.length > 0 && verificationFail.length > 0
    ? dimension("mixed", "observed pass and failure", [...verificationPass, ...verificationFail].map((record) => record.evidenceId), "Verification receipts contain both successful and failed observations.")
    : verificationPass.length > 0
      ? dimension("pass", "observed verification pass", verificationPass.map((record) => record.evidenceId), "A test, build, lint, or verification tool result reports success.")
      : verificationFail.length > 0
        ? dimension("fail", "observed verification failure", verificationFail.map((record) => record.evidenceId), "A test, build, lint, or verification tool result reports failure.")
        : dimension("unknown", "no observed verification receipt", [], "Assistant statements about tests or correctness are not verification evidence.");

  const successfulResults = toolResults.filter(recordIsSuccess);
  const recoveredFailures = failures.filter((failure) => {
    if (!failure.tool || failure.tool.phase !== "result") return false;
    const failureIdentity = normalizedToolIdentity(failure, calls);
    if (!failureIdentity) return false;
    const failureEpisode = episodeForRecord(failure, records);
    return successfulResults.some((success) => success.sequence > failure.sequence
      && episodeForRecord(success, records) === failureEpisode
      && normalizedToolIdentity(success, calls) === failureIdentity);
  });
  const unresolvedFailures = failures.filter((failure) => !recoveredFailures.includes(failure));
  const recovery = failures.length === 0
    ? toolResults.length > 0 && !toolResults.some((record) => record.missingOutput)
      ? dimension("pass", "no recovery required", toolResults.map((record) => record.evidenceId), "Complete tool receipts contain no observed failure requiring recovery.")
      : dimension("unknown", "no failure to recover", [], "The transcript does not contain an observed failure/recovery sequence.")
    : recoveredFailures.length > 0 && unresolvedFailures.length > 0
      ? dimension("mixed", "some matching commands recovered", [...recoveredFailures, ...unresolvedFailures].map((record) => record.evidenceId), "Some failed receipts were followed by a matching command/check success; others remain unresolved.")
      : recoveredFailures.length > 0
        ? dimension("pass", "matching command/check recovered", recoveredFailures.map((record) => record.evidenceId), "A failed receipt was followed by a successful receipt for the same normalized command/check.")
        : dimension("fail", "failure unresolved", failures.map((record) => record.evidenceId), "An observed failure has no later matching command/check success receipt.");

  const unknownBound = truncated || unsupported || records.some((record) => record.missingOutput || record.status === "unknown");
  const unresolvedIssues = unresolvedFailures.length > 0
    ? dimension("fail", "observed unresolved issue", unresolvedFailures.map((record) => record.evidenceId), "An observed error or failed result remains without recovery evidence.")
    : unknownBound
      ? dimension("unknown", "unresolved issues unknown", records.filter((record) => record.missingOutput || record.unsupported || record.truncated || record.status === "unknown").map((record) => record.evidenceId), "Missing output, unsupported records, or truncation prevents a complete unresolved-issue determination.")
      : toolResults.length > 0
        ? dimension("pass", "no unresolved tool issue observed", toolResults.map((record) => record.evidenceId), "All retained tool results are complete and no unresolved failure was observed.")
        : dimension("unknown", "no issue evidence", [], "The source contains no tool receipts from which unresolved issues can be determined.");

  // Sufficiency answers whether the retained source is adequate to support an
  // assessment, independently of whether that assessment is positive. A
  // complete observed failure is sufficient evidence of failure; it is not a
  // reason to label the evidence itself insufficient.
  const hasObservedAssessment = failures.length > 0 || verificationRecords.length > 0 || completionReceipts.length > 0;
  const hasUnknownBoundary = truncated || unsupported || records.some((record) => record.missingOutput || record.unsupported || record.truncated || record.status === "unknown");
  const sufficiency: EvidenceSufficiency = !hasObservedAssessment
    ? "unknown"
    : hasUnknownBoundary
      ? "insufficient"
      : "sufficient";

  return { completionEvidence, verification, recovery, unresolvedIssues, sufficiency, observedEvidenceIds: [...new Set(observedEvidenceIds)], ignoredClaimEvidenceIds: [...new Set(ignoredClaimEvidenceIds)] };
}

/** Build the browser-safe packet consumed by Timeline and Luna-facing UI. */
export function buildEvidencePacket(file: string, options: BuildEvidencePacketOptions = {}): EvidencePacket {
  const maxRecords = Math.max(1, Math.floor(options.maxRecords ?? DEFAULT_MAX_RECORDS));
  const maxBytes = Math.max(1, Math.floor(options.maxBytes ?? DEFAULT_MAX_BYTES));
  const excerptChars = Math.max(40, Math.floor(options.excerptChars ?? DEFAULT_EXCERPT_CHARS));
  const maxEpisodes = Math.max(1, Math.floor(options.maxEpisodes ?? 32));
  const read = collectEvidenceRecords(file, { ...options, maxRecords, maxBytes, excerptChars });
  const records = read.records;
  const episodeData = buildEpisodes(records, maxEpisodes);
  const bounds: EvidencePacketBounds = {
    maxRecords,
    maxBytes,
    excerptChars,
    recordsRetained: records.length,
    sourceRecords: read.sourceRecords,
    bytesRead: read.bytesRead,
    truncated: read.truncated,
    unsupported: read.unsupported,
    malformedRecords: read.malformedRecords,
    omittedRecords: read.omittedRecords,
    warnings: read.warnings.filter((warning) => !warning.startsWith("contentDigest:")),
  };
  const contentDigest = digest(`${read.sourceId}\0${read.sessionId}\0${read.format}\0${read.contentDigest}`);
  const packet: EvidencePacket = {
    version: "evidence-packet.v1",
    sourceId: read.sourceId,
    sessionId: read.sessionId,
    format: read.format,
    contentDigest,
    records,
    episodes: episodeData.episodes,
    feedback: episodeData.feedback,
    ...(episodeData.openingAskEvidenceId ? { openingAskEvidenceId: episodeData.openingAskEvidenceId } : {}),
    constraintEvidenceIds: episodeData.constraintEvidenceIds,
    ...(episodeData.finalOutputEvidenceId ? { finalOutputEvidenceId: episodeData.finalOutputEvidenceId } : {}),
    bounds,
    evaluation: { completionEvidence: dimension("unknown", "pending", [], ""), verification: dimension("unknown", "pending", [], ""), recovery: dimension("unknown", "pending", [], ""), unresolvedIssues: dimension("unknown", "pending", [], ""), sufficiency: "unknown", observedEvidenceIds: [], ignoredClaimEvidenceIds: [] },
  };
  packet.evaluation = evaluateEvidencePacket(packet);
  return packet;
}

/** Alias used by collection routes that describe the operation as a read. */
export const readEvidencePacket = buildEvidencePacket;

/** Evaluate already normalized records without touching the filesystem. */
export const evaluateEvidenceRecords = evaluateEvidencePacket;
