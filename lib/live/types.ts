import type { FieldMapping } from "../adapters/generic";
import type { ParseWarningCounts } from "./warning-taxonomy";

export type MetricSource = "measured" | "inferred" | "missing" | "malformed";

export interface LiveMetricSources {
  model: MetricSource;
  tokens: MetricSource;
  cost: MetricSource;
  duration: MetricSource;
  turns: MetricSource;
}

export type LiveSourceStatus = "available" | "unavailable" | "error";

export interface LiveUsageSegment {
  atMs: number;
  cumulativeInput: number;
  cumulativeOutput: number;
  deltaInput: number;
  deltaOutput: number;
  outTokPerSec: number;
}

export interface LiveUsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreateTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  sessionsWithMeasuredUsage: number;
  sessionsWithMeasuredCost: number;
  /** Any recorded or priced cost evidence, including an exact measured $0. */
  sessionsWithCostEvidence: number;
  sessionsWithPricedUsage: number;
  sessionsWithListedRate: number;
  sessionsWithFamilyRate: number;
  sessionsWithFallbackRate: number;
  tokenCoverage: number;
  costCoverage: number;
  avgOutputTokPerSec: number;
}

export interface LiveToolSummary {
  name: string;
  calls: number;
  errors: number;
}

export interface LiveTraceGraph {
  rootMessages: number;
  sidechainMessages: number;
  agentCount: number;
  orphanMessages: number;
}

export interface LiveQueueSummary {
  enqueue: number;
  dequeue: number;
  remove: number;
  popAll: number;
  preview: string[];
}

export interface LiveFileActivity {
  touchedFiles: string[];
  readLikeOperations: number;
  writeLikeOperations: number;
}

export interface LiveModeSummary {
  permissionModes: Record<string, number>;
  gitBranch: string | null;
  entrypoint: string | null;
}

export interface LiveSessionToolDuration {
  name: string;
  count: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  errors: number;
}

export interface LiveModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  toolCalls: number;
  toolErrors: number;
}

export interface LiveSession {
  sessionId: string;
  /** Explicit child-agent identity when the trace format records it. */
  isSubagent?: boolean;
  /** Parent thread/session id when the child trace records a stable link. */
  parentSessionId?: string | null;
  /** Human-readable child label or storage agent id, when available. */
  agentLabel?: string | null;
  displayTitle: string | null;
  lastPromptPreview: string | null;
  project: string;
  model: string | null;
  startedAt: number;
  lastEventAt: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  totalTokens: number;
  costUsd: number;
  /** Exact per-model attribution when a trace records model identity per turn. */
  modelUsage?: LiveModelUsage[];
  usageSegments: LiveUsageSegment[];
  toolCalls: number;
  toolErrors: number;
  numTurns: number;
  stopReason: string | null;
  isError: boolean;
  pathBytes: number;
  lineCount: number;
  malformedLineCount: number;
  thinkingBlocks: number;
  textBlocks: number;
  attachmentCount: number;
  queueOperationCount: number;
  snapshotCount: number;
  hookErrors: number;
  messageCount: number;
  userType: string | null;
  dataQuality: number;
  metricSources: LiveMetricSources;
  parseWarnings: string[];
  toolErrorRate: number;
  toolCallsPerTurn: number;
  textAvailability: number;
  staleMs: number;
  traceGraph: LiveTraceGraph;
  toolSummaries: LiveToolSummary[];
  toolDurations: LiveSessionToolDuration[];
  queueSummary: LiveQueueSummary;
  fileActivity: LiveFileActivity;
  modeSummary: LiveModeSummary;
  path?: string;
  /** True when this session's file was pruned from disk and only the cached parse remains. */
  archived?: boolean;
  /** Longitudinal markers: what this session used (for adoption timelines). */
  skillsUsed: string[];
  mcpServersUsed: string[];
  subagentSpawns: number;
  cliVersion: string | null;
  /** Heuristic outcome signals inferred from the transcript's own text. */
  outcomeSignals: OutcomeSignals;
}

/**
 * The session shape sent to the Live list and its polling API.
 *
 * The parser/cache keep the complete LiveSession for Collection and
 * longitudinal analytics, but a list row does not need prompt previews,
 * per-turn usage, tool/file/queue breakdowns, or outcome markers. Keeping a
 * separate public projection prevents those drawer-only arrays from being
 * serialized for every row while retaining everything the filters, table, and
 * API signature use.
 */
export type LiveSessionListItem = Pick<LiveSession,
  | "sessionId"
  | "isSubagent"
  | "parentSessionId"
  | "agentLabel"
  | "displayTitle"
  | "project"
  | "model"
  | "startedAt"
  | "lastEventAt"
  | "durationMs"
  | "inputTokens"
  | "outputTokens"
  | "cacheReadTokens"
  | "cacheCreateTokens"
  | "totalTokens"
  | "costUsd"
  | "toolCalls"
  | "toolErrors"
  | "numTurns"
  | "stopReason"
  | "isError"
  | "pathBytes"
  | "lineCount"
  | "malformedLineCount"
  | "thinkingBlocks"
  | "textBlocks"
  | "attachmentCount"
  | "queueOperationCount"
  | "snapshotCount"
  | "hookErrors"
  | "messageCount"
  | "userType"
  | "dataQuality"
  | "metricSources"
  | "parseWarnings"
  | "toolErrorRate"
  | "toolCallsPerTurn"
  | "textAvailability"
> & {
  /** Only the graph counters shown in the list row; detail has the rest. */
  traceGraph: Pick<LiveTraceGraph, "rootMessages" | "sidechainMessages" | "agentCount" | "orphanMessages">;
  /** Only the branch marker shown in the list row; detail has permissions/entrypoint. */
  modeSummary: Pick<LiveModeSummary, "gitBranch">;
  /** Bounded output-rate samples used by the row sparkline. */
  usageRates?: number[];
  path?: string;
  archived?: boolean;
};

export type LiveAggregateList = Omit<LiveAggregate, "sessions"> & {
  sessions: LiveSessionListItem[];
};

export interface OutcomeSignals {
  userPositive: number;
  userNegative: number;
  rephrases: number;
  errorTail: boolean;
  testsPassedTail: boolean;
  reworkFiles: number;
}

/**
 * Exact population boundary for a live scan. Aggregate totals describe the
 * parsed slice, not every transcript file present on disk.
 */
export interface LiveScanCoverage {
  requestedLimit: number;
  discoveredFiles: number;
  scannedFiles: number;
  parsedFiles: number;
  droppedFiles: number;
  unscannedFiles: number;
  archivedSessionsAdded: number;
  truncated: boolean;
  /** Discovery or parse warnings mean the population is not proven complete. */
  partial: boolean;
}

export interface LiveAggregate {
  sourceHarness: string;
  sourceLabel: string;
  sourceStatus: LiveSourceStatus;
  sourceRoots: string[];
  sourceMessage?: string;
  usageSummary: LiveUsageSummary;
  totalSessions: number;
  totalProjects: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalToolCalls: number;
  totalToolErrors: number;
  sessionsWithMeasuredDuration: number;
  sessionsWithInferredDuration: number;
  subagentSessions: number;
  sessionsWithMeasuredModel: number;
  sessionsWithMissingModel: number;
  sessionsWithInferredModel: number;
  sessionsWithMissingTokens: number;
  sessionsWithInferredCost: number;
  archivedSessions: number;
  sessionsWithMalformedLines: number;
  staleSessions: number;
  avgDataQuality: number;
  scanCoverage: LiveScanCoverage;
  scanWarnings: string[];
  /** Actionable parser-warning counts over the full parsed population. */
  parseWarningCounts: ParseWarningCounts;
  byModel: Array<{
    model: string;
    sessions: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    toolCalls: number;
    errors: number;
    avgDurationMs: number;
    avgDataQuality: number;
    missingTokens: number;
    missingCost: number;
    pricedSessions: number;
    measuredCostSessions: number;
    allocatedCostSessions: number;
    listedRateSessions: number;
    familyRateSessions: number;
    fallbackRateSessions: number;
    inferredModelSessions: number;
  }>;
  byTool: LiveToolSummary[];
  queueTotals: LiveQueueSummary;
  sidechainMessages: number;
  agentSessions: number;
  topBranches: Array<{ branch: string; sessions: number }>;
  topFiles: Array<{ file: string; sessions: number }>;
  sessions: LiveSession[];
}

export interface LiveTranscriptTurn {
  type: string;
  subtype?: string;
  severity: "info" | "warning" | "error";
  at?: number;
  label: string;
  preview: string;
  /** Conversation role for viewer grouping; "meta" = protocol/bookkeeping noise. */
  role?: "user" | "assistant" | "tool" | "meta";
  /** Structured, bounded tool evidence retained without copying the raw record. */
  tool?: {
    callId?: string;
    name: string;
    phase: "call" | "result";
    status?: string;
    durationMs?: number;
  };
  /** Structured multimodal evidence retained without embedding image/file payloads. */
  media?: {
    images?: number;
    files?: number;
  };
  /** Bounded provenance for an agent-reasoning/thinking projection. */
  reasoning?: {
    kind: "summary" | "thinking" | "encrypted" | "truncated";
    source: "codex" | "claude" | "generic";
  };
}

export interface TranscriptNormalization {
  /** Non-empty raw records parsed before the semantic display projection. */
  rawRecords: number;
  /** Codex event/response copies with the same role and exact text hidden once. */
  suppressedMirrors: number;
  /** Compound Claude-style records split into separate prose/reasoning/tool turns. */
  compoundRecords: number;
}

export interface TranscriptResult {
  turns: LiveTranscriptTurn[];
  error?: string;
  /** The bounded parser or error-context projection omitted additional turns. */
  truncated?: boolean;
  /** Honest accounting for the raw-record to semantic-turn viewer projection. */
  normalization?: TranscriptNormalization;
}

export interface LiveSessionDetailResult {
  session?: LiveSession;
  error?: string;
}

export type LiveTraceFormat = "claude-projects" | "codex-sessions" | "jsonl-dir" | "hermes-json";

export interface LiveTraceSource {
  id: string;
  label: string;
  status: LiveSourceStatus;
  roots: string[];
  message?: string;
  fields?: FieldMapping;
  format: LiveTraceFormat;
  maxDepth: number;
  inferredModel?: string;
}

/**
 * A transcript-collection source that is NOT necessarily a runnable harness —
 * "you might have Cursor transcripts without being able to run Cursor." Roots
 * may use `~`; they are home-expanded here. This is the public shape the
 * collection registry hands to `scanSourceSessions` / `listSourceFiles`.
 */
export interface CollectionSourceSpec {
  id: string;
  label: string;
  roots: string[];
  format: LiveTraceFormat;
  fields?: FieldMapping;
  maxDepth?: number;
  inferredModel?: string;
}

export interface CollectedSourceFiles {
  files: Array<{ file: string; project: string; mtime: number; size: number }>;
  scanWarnings: string[];
}

/** Walk-time stat, reusable as the cache key so summarize needn't re-stat. */
export interface KnownFileStat { mtimeMs: number; size: number }
