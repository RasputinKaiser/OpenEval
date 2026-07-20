/**
 * Live trace intelligence — public API.
 *
 * The implementation lives in lib/live/ (scan/discovery, per-source parsers,
 * summary cache, transcript viewer parsing, aggregation). This module is the
 * stable import surface: everything previously exported from the monolithic
 * lib/live.ts is re-exported here unchanged.
 */
export type {
  MetricSource,
  LiveMetricSources,
  LiveSourceStatus,
  LiveUsageSegment,
  LiveUsageSummary,
  LiveToolSummary,
  LiveTraceGraph,
  LiveQueueSummary,
  LiveFileActivity,
  LiveModeSummary,
  LiveSessionToolDuration,
  LiveModelUsage,
  LiveSession,
  OutcomeSignals,
  LiveAggregate,
  LiveTranscriptTurn,
  TranscriptResult,
  LiveTraceFormat,
  CollectionSourceSpec,
  CollectedSourceFiles,
  KnownFileStat,
} from "./live/types";
export { compactDisplayPath, redactSensitiveText } from "./redaction";
export { looksLikeToolError, codexToolOutputError, readFileLines, MAX_USAGE_SEGMENTS } from "./live/util";
export { defaultLiveLimitForHarness, isPathInLiveSource, liveTraceFormatForHarness } from "./live/sources";
export { summarizeLiveSessionFile, summarizeHermesSessionFile, summarizeCodexSessionFile } from "./live/summarize";
export { parseSessionTranscript, getErroringTurns } from "./live/transcript";
export { stripIdeContextWrapper } from "./live/parse-codex";
export {
  listSourceFiles,
  collectSourceFiles,
  scanSourceSessions,
  scanLiveSessions,
  collectSourceSessions,
} from "./live/scan";
