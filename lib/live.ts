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
  LiveSessionListItem,
  OutcomeSignals,
  LiveScanCoverage,
  LiveAggregate,
  LiveAggregateList,
  LiveTranscriptTurn,
  TranscriptNormalization,
  TranscriptResult,
  LiveSessionDetailResult,
  LiveTraceFormat,
  CollectionSourceSpec,
  CollectedSourceFiles,
  KnownFileStat,
} from "./live/types";
export { compactDisplayPath, redactSensitiveText } from "./redaction";
export { looksLikeToolError, codexToolOutputError, readFileLines, MAX_USAGE_SEGMENTS, MAX_EXTRACTED_FILE_PATHS, MAX_TRACE_METADATA_ITEMS, appendUsageSegment } from "./live/util";
export { defaultLiveLimitForHarness, isPathInLiveSource, liveTraceFormatForHarness } from "./live/sources";
export { summarizeLiveSessionFile, summarizeHermesSessionFile, summarizeCodexSessionFile } from "./live/summarize";
export { parseSessionTranscript, getErroringTurns, ERRORING_TURN_CAP } from "./live/transcript";
export { stripIdeContextWrapper } from "./live/parse-codex";
export {
  listSourceFiles,
  collectSourceFiles,
  scanSourceSessions,
  scanLiveSessions,
  collectSourceSessions,
  projectLiveSession,
  projectLiveAggregate,
  resolveLiveSessionFile,
  readLiveSessionDetail,
} from "./live/scan";
