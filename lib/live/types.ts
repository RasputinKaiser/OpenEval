import type { FieldMapping } from "../adapters/generic";

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

export interface OutcomeSignals {
  userPositive: number;
  userNegative: number;
  rephrases: number;
  errorTail: boolean;
  testsPassedTail: boolean;
  reworkFiles: number;
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
  sessionsWithMissingModel: number;
  sessionsWithInferredModel: number;
  sessionsWithMissingTokens: number;
  sessionsWithInferredCost: number;
  archivedSessions: number;
  sessionsWithMalformedLines: number;
  staleSessions: number;
  avgDataQuality: number;
  scanWarnings: string[];
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
}

export interface TranscriptResult {
  turns: LiveTranscriptTurn[];
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
