import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { StringDecoder } from "node:string_decoder";
import { compactDisplayPath, redactSensitiveText } from "./redaction";
import { getPath, type FieldMapping } from "./adapters/generic";
import { hermesJsonToRecords } from "./adapters/hermes";
import { estimateCostUsd } from "./pricing";
import { cacheGet, cachePut, listCachedSessionsUnder } from "./live-cache";
import { classifySentiment, isRephrase, looksLikeApologyOrFailure, looksLikeTestsPassed, mcpServerFromTool, JUDGE_PROMPT_MARKER } from "./insights/signals";
import { listAdapters, hasAdapter, getAdapter, getDefaultHarness, invalidateRegistry } from "./adapters/registry";
import { invalidateDescriptorCache } from "./adapters/loader";

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

export { compactDisplayPath, redactSensitiveText };

export type LiveTraceFormat = "claude-projects" | "codex-sessions" | "jsonl-dir" | "hermes-json";

interface LiveTraceSource {
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

function defaultMaxDepth(format: LiveTraceFormat): number {
  return format === "codex-sessions" ? 5 : format === "claude-projects" ? 2 : 4;
}

function specToSource(spec: CollectionSourceSpec): LiveTraceSource {
  return {
    id: spec.id,
    label: spec.label,
    status: "available",
    roots: spec.roots.map(expandHome),
    fields: spec.fields,
    format: spec.format,
    maxDepth: spec.maxDepth ?? defaultMaxDepth(spec.format),
    inferredModel: spec.inferredModel,
  };
}

/** Session files for a source, without parsing them — cheap discovery counts. */
export function listSourceFiles(spec: CollectionSourceSpec): Array<{ file: string; project: string; mtime: number }> {
  return collectLiveTraceFiles(specToSource(spec), []);
}

/** Scan one arbitrary collection source (any harness), reusing the harness path. */
export function scanSourceSessions(spec: CollectionSourceSpec, limit = 200, opts: { includeArchived?: boolean } = {}): LiveAggregate {
  return scanResolvedSource(specToSource(spec), limit, opts.includeArchived ?? false);
}

export function defaultLiveLimitForHarness(harness?: string): number {
  const source = resolveLiveSource(harness);
  return source.format === "codex-sessions" ? 50 : 200;
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

/**
 * Live trace sources come from harness descriptors (`liveTrace`) — bundled and
 * user-defined alike. If the harness isn't in the registry yet (e.g. a
 * descriptor file was just added), the registry is refreshed once.
 */
function resolveLiveSource(harness?: string): LiveTraceSource {
  const id = harness || getDefaultHarness();
  if (!hasAdapter(id)) {
    invalidateDescriptorCache();
    invalidateRegistry();
  }
  if (hasAdapter(id)) {
    const adapter = getAdapter(id);
    const lt = adapter.descriptor.liveTrace;
    if (lt) {
      const format: LiveTraceFormat = lt.format ?? "jsonl-dir";
      return {
        id: adapter.id,
        label: adapter.label,
        status: "available",
        roots: lt.roots.map(expandHome),
        fields: lt.fields ?? (format === "jsonl-dir" ? adapter.descriptor.fields : undefined),
        format,
        maxDepth: lt.maxDepth ?? (format === "codex-sessions" ? 5 : format === "claude-projects" ? 2 : 4),
        inferredModel: lt.inferredModel,
      };
    }
    return {
      id: adapter.id,
      label: adapter.label,
      status: "unavailable",
      roots: [],
      format: "jsonl-dir",
      maxDepth: 0,
      message: `${adapter.label} does not declare a liveTrace source yet.`,
    };
  }
  return {
    id,
    label: id,
    status: "unavailable",
    roots: [],
    format: "jsonl-dir",
    maxDepth: 0,
    message: `Unknown harness "${id}" does not have a registered live trace source.`,
  };
}

export function isPathInLiveSource(filePath: string, harness?: string): boolean {
  const source = resolveLiveSource(harness);
  if (source.status !== "available") return false;
  const resolved = path.resolve(filePath);
  return source.roots.some((root) => {
    const rootPath = path.resolve(root);
    const rel = path.relative(rootPath, resolved);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
}

function decodeProjectDir(name: string): string {
  return name
    .replace(/^-/, "/")
    .replace(/--/g, "/.")
    .replace(/-/g, "/");
}

/**
 * Heuristic: does a tool's raw output text indicate a failure? Codex
 * `function_call_output` events carry no structured error flag, so we sniff the
 * text — but only for real error INDICATORS, not any occurrence of the words
 * "error"/"failed". Matching those as bare substrings flagged benign output
 * ("5 passed, 0 failed", "0 errors", "error handling") as failures, inflating
 * error rates and depressing data-quality scores across most real sessions.
 */
export function looksLikeToolError(output: string): boolean {
  if (!output) return false;
  return (
    /(?:exit(?:ed)? with code|exit code)\s+[1-9]/i.test(output) ||
    /traceback \(most recent call last\)/i.test(output) ||
    /\b(?:error|fatal|panic)\s*:/i.test(output) ||
    /\b(?:command not found|no such file or directory|permission denied|segmentation fault|command failed)\b/i.test(output)
  );
}

const MIN_PLAUSIBLE_MS = 1_577_836_800_000; // 2020-01-01

function parseTimestamp(value: unknown): number | null {
  let ms: number | null = null;
  if (typeof value === "number" && Number.isFinite(value)) {
    // Some harnesses (Codex) log UNIX seconds; interpreting them as ms lands
    // near 1970 and corrupts startedAt. Anything below ~1e12 is seconds.
    ms = value < 1e12 ? value * 1000 : value;
  } else if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) ms = parsed;
  }
  // Reject implausible/placeholder timestamps rather than let them pull startedAt down.
  if (ms == null || ms < MIN_PLAUSIBLE_MS) return null;
  return ms;
}

function jsonPreview(value: unknown, max = 420): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * sortedAsc.length));
  return sortedAsc[idx];
}

function summarizeToolDurations(
  durationMs: Map<string, number[]>,
  toolErrorsByName: Map<string, number>,
  limit = 10,
): LiveSessionToolDuration[] {
  return [...durationMs.entries()]
    .map(([name, durations]) => {
      const sorted = durations.slice().sort((a, b) => a - b);
      return {
        name,
        count: sorted.length,
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
        maxMs: sorted[sorted.length - 1] ?? 0,
        errors: toolErrorsByName.get(name) ?? 0,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function metricMissing(source: MetricSource): boolean {
  return source === "missing" || source === "malformed";
}

function increment(map: Map<string, number>, key: string | null | undefined, amount = 1): void {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + amount);
}

function incrementRecord(record: Record<string, number>, key: string | null | undefined, amount = 1): void {
  if (!key) return;
  record[key] = (record[key] ?? 0) + amount;
}

function topEntries(map: Map<string, number>, limit: number): Array<{ key: string; count: number }> {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function extractFilePaths(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    const pathLike = value.match(/(?:\/Users\/[^\s"'<>`]+|\/home\/[^\s"'<>`]+|\/private\/tmp\/[^\s"'<>`]+|\/tmp\/[^\s"'<>`]+|\.{1,2}\/[A-Za-z0-9._/-]+)/g) ?? [];
    for (const candidate of pathLike) {
      const cleaned = candidate.replace(/[),.;:]+$/, "");
      if (cleaned.includes("://") || cleaned.startsWith("//")) continue;
      if (/[\[\]\^\?\*\|\\`]/.test(cleaned)) continue;
      if (cleaned.includes("/") && !cleaned.endsWith("/")) out.add(cleaned);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) extractFilePaths(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) extractFilePaths(item, out);
  }
  return out;
}

export function scanLiveSessions(limit = 200, harness?: string): LiveAggregate {
  return scanResolvedSource(resolveLiveSource(harness), limit);
}

function parseSourceSessionList(source: LiveTraceSource, limit: number, scanWarnings: string[], includeArchived = false): LiveSession[] {
  const sessions: LiveSession[] = [];
  if (source.status !== "available") return sessions;
  const files = collectLiveTraceFiles(source, scanWarnings);
  files.sort((a, b) => b.mtime - a.mtime);
  for (const f of files.slice(0, limit)) {
    const s = source.format === "codex-sessions"
      ? summarizeCodexSessionFile(f.file, f.project, f.mtime)
      : source.format === "hermes-json"
        ? summarizeHermesSessionFile(f.file, f.project, f.mtime)
        : summarizeLiveSessionFile(f.file, f.project, f.mtime, { fields: source.fields, inferredModel: source.inferredModel, decodeProject: source.format !== "jsonl-dir" });
    if (s) sessions.push(s);
  }
  if (includeArchived) appendArchivedSessions(source, sessions);
  return sessions;
}

/**
 * Merge in ARCHIVED sessions: cached parses whose files were since pruned from
 * disk (Claude Code keeps ~30 days of transcripts; history should not follow
 * them into the void). Dedupes on sessionId so a rotated/moved file doesn't
 * count twice; the on-disk copy always wins.
 */
function appendArchivedSessions(source: LiveTraceSource, sessions: LiveSession[]): void {
  const seenIds = new Set(sessions.map((s) => s.sessionId));
  for (const { file, session } of listCachedSessionsUnder(source.roots)) {
    let onDisk = false;
    try { onDisk = fs.existsSync(file); } catch {}
    if (onDisk || seenIds.has(session.sessionId)) continue;
    seenIds.add(session.sessionId);
    sessions.push({ ...session, archived: true, staleMs: Math.max(0, Date.now() - session.lastEventAt) });
  }
  sessions.sort((a, b) => b.lastEventAt - a.lastEventAt);
}

/**
 * Full parsed session list for a source, UNCAPPED (the aggregate's `sessions`
 * array is sliced to 100 for the live view; longitudinal analytics need them all).
 */
export function collectSourceSessions(spec: CollectionSourceSpec, limit = 100_000, opts: { includeArchived?: boolean } = {}): LiveSession[] {
  return parseSourceSessionList(specToSource(spec), limit, [], opts.includeArchived ?? false);
}

function scanResolvedSource(source: LiveTraceSource, limit: number, includeArchived = false): LiveAggregate {
  const scanWarnings: string[] = [];
  if (source.status !== "available" && source.message) scanWarnings.push(source.message);
  const sessions = parseSourceSessionList(source, limit, scanWarnings, includeArchived);
  return aggregate(sessions, scanWarnings, source);
}

function collectLiveTraceFiles(source: LiveTraceSource, scanWarnings: string[]): Array<{ file: string; project: string; mtime: number }> {
  const files: Array<{ file: string; project: string; mtime: number }> = [];
  for (const root of source.roots) {
    if (source.format === "claude-projects") {
      let projectDirs: string[] = [];
      try {
        projectDirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
      } catch (e) {
        scanWarnings.push(`Could not read ${root}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      for (const pd of projectDirs) {
        const pdir = path.join(root, pd);
        let entries: fs.Dirent[] = [];
        try {
          entries = fs.readdirSync(pdir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const ent of entries) {
          if (!ent.isFile() || !ent.name.endsWith(".jsonl")) continue;
          const full = path.join(pdir, ent.name);
          try {
            const st = fs.statSync(full);
            files.push({ file: full, project: pd, mtime: st.mtimeMs });
          } catch {}
        }
      }
    } else if (source.format === "hermes-json") {
      // Hermes sessions are single-JSON files; skip its request_dump_* payload logs.
      collectJsonlRecursive(root, source.maxDepth, files, root, (name) => name.startsWith("session_") && name.endsWith(".json"));
    } else {
      collectJsonlRecursive(root, source.maxDepth, files, root);
    }
  }
  return files;
}

function collectJsonlRecursive(
  dir: string,
  depth: number,
  files: Array<{ file: string; project: string; mtime: number }>,
  root: string,
  matches: (name: string) => boolean = (name) => name.endsWith(".jsonl"),
): void {
  if (depth < 0) return;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      collectJsonlRecursive(full, depth - 1, files, root, matches);
      continue;
    }
    if (!ent.isFile() || !matches(ent.name)) continue;
    try {
      const st = fs.statSync(full);
      files.push({ file: full, project: path.dirname(path.relative(root, full)) || path.basename(root), mtime: st.mtimeMs });
    } catch {}
  }
}

const TRANSCRIPT_TURN_CAP = 20_000;

export function parseSessionTranscript(filePath: string): TranscriptResult {
  try {
    const turns: LiveTranscriptTurn[] = [];
    let index = 0;
    // Stream (don't readFileSync a giant string) and cap turns so a multi-hundred-MB
    // session can be opened without exhausting memory.
    for (const line of readFileLines(filePath)) {
      if (!line.trim()) continue;
      index++;
      try {
        turns.push(toTranscriptTurn(JSON.parse(line), index));
      } catch {
        turns.push({
          type: "malformed",
          severity: "warning",
          label: `Malformed line ${index}`,
          preview: line.slice(0, 420),
        });
      }
      if (turns.length >= TRANSCRIPT_TURN_CAP) {
        turns.push({
          type: "truncated",
          severity: "info",
          label: `Transcript truncated at ${TRANSCRIPT_TURN_CAP} lines`,
          preview: "This session is very large; earlier lines are shown.",
        });
        break;
      }
    }
    return { turns };
  } catch (e) {
    return { turns: [], error: e instanceof Error ? e.message : String(e) };
  }
}

function isErroringTurn(turn: LiveTranscriptTurn): boolean {
  return turn.severity === "error" || turn.severity === "warning";
}

export function getErroringTurns(filePath: string): TranscriptResult {
  const parsed = parseSessionTranscript(filePath);
  if (parsed.error) return { turns: [], error: parsed.error };
  const keep = new Set<number>();
  parsed.turns.forEach((turn, index) => {
    if (!isErroringTurn(turn)) return;
    keep.add(Math.max(0, index - 1));
    keep.add(index);
    keep.add(Math.min(parsed.turns.length - 1, index + 1));
  });
  return { turns: [...keep].sort((a, b) => a - b).map((index) => parsed.turns[index]) };
}

export function summarizeLiveSessionFile(file: string, projectDir: string, mtime: number, opts: { fields?: FieldMapping; inferredModel?: string; decodeProject?: boolean } = {}): LiveSession | null {
  return summarizeWithCache(file, projectDir, mtime, (f, lines, bytes, pd, mt) => parseLiveSession(f, lines, bytes, pd, mt, opts.fields, opts.inferredModel, opts.decodeProject));
}

const HERMES_MAX_BYTES = 32 * 1024 * 1024; // whole-file JSON parse; real sessions are ≤ a few MB

/** Hermes single-JSON sessions, re-emitted as Claude-style records (see adapters/hermes). */
export function summarizeHermesSessionFile(file: string, projectDir: string, mtime: number): LiveSession | null {
  return summarizeWithCache(file, projectDir, mtime, (f, lines, bytes, pd, mt) => {
    if (bytes > HERMES_MAX_BYTES) return null;
    let raw = "";
    for (const line of lines) raw += line + "\n";
    const records = hermesJsonToRecords(raw);
    if (records.length === 0) return null;
    return parseLiveSession(f, records, bytes, pd, mt, undefined, undefined, false);
  });
}

const sessionCache = new Map<string, { mtimeMs: number; size: number; session: LiveSession | null }>();
const SESSION_CACHE_LIMIT = 500;

/**
 * Stream a file's lines without ever materializing the whole file as one string.
 * `fs.readFileSync(file, "utf8")` throws ERR_STRING_TOO_LONG on files over ~512MB
 * — real agent sessions get that big — which silently dropped the largest (and
 * most token-heavy) sessions from every total. Reads in bounded chunks with a
 * StringDecoder so multibyte characters spanning a chunk boundary aren't
 * corrupted, holding at most one chunk + one line in memory.
 */
export function* readFileLines(file: string): Generator<string> {
  const CHUNK = 1 << 20; // 1 MiB
  const fd = fs.openSync(file, "r");
  const decoder = new StringDecoder("utf8");
  try {
    const buf = Buffer.allocUnsafe(CHUNK);
    let leftover = "";
    let n: number;
    while ((n = fs.readSync(fd, buf, 0, CHUNK, null)) > 0) {
      leftover += decoder.write(buf.subarray(0, n));
      let idx: number;
      while ((idx = leftover.indexOf("\n")) >= 0) {
        yield leftover.slice(0, idx);
        leftover = leftover.slice(idx + 1);
      }
    }
    leftover += decoder.end();
    if (leftover.length) yield leftover;
  } finally {
    fs.closeSync(fd);
  }
}

function summarizeWithCache(
  file: string,
  projectDir: string,
  mtime: number,
  parser: (file: string, lines: Iterable<string>, bytes: number, projectDir: string, mtime: number) => LiveSession | null,
): LiveSession | null {
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  // staleMs is stamped at parse time; cached copies (memory or disk) must not
  // freeze it, so refresh it on every cache hit.
  const refresh = (s: LiveSession | null): LiveSession | null =>
    s ? { ...s, staleMs: Math.max(0, Date.now() - s.lastEventAt) } : s;

  const cached = sessionCache.get(file);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
    return refresh(cached.session);
  }
  // Second tier: the persistent SQLite cache survives restarts, so cold
  // full-history scans don't re-parse hundreds of MB of unchanged files.
  const persisted = cacheGet(file, st.mtimeMs, st.size);
  let session: LiveSession | null;
  if (persisted.hit) {
    session = persisted.session;
  } else {
    try {
      // The file can vanish or become unreadable between statSync and here (log
      // rotation, active session dirs). Skip one file rather than aborting the scan.
      session = parser(file, readFileLines(file), st.size, projectDir, mtime);
    } catch {
      return null;
    }
    cachePut(file, st.mtimeMs, st.size, session);
  }
  if (sessionCache.size >= SESSION_CACHE_LIMIT) {
    const oldest = sessionCache.keys().next().value;
    if (oldest !== undefined) sessionCache.delete(oldest);
  }
  sessionCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, session });
  return refresh(session);
}

function parseLiveSession(file: string, lines: Iterable<string>, bytes: number, projectDir: string, mtime: number, fields?: FieldMapping, inferredModel?: string, decodeProject = true): LiveSession | null {
  let model: string | null = null;
  let sessionId: string | null = null;
  let displayTitle: string | null = null;
  let lastPromptPreview: string | null = null;
  // Only dash-encoded formats (claude-projects / ncode) need decoding; jsonl-dir
  // project names are already real relative paths and get corrupted by it.
  let project = decodeProject ? decodeProjectDir(projectDir) : projectDir;
  // Longitudinal markers + heuristic outcome signals.
  const skillsUsed = new Set<string>();
  const mcpServersUsed = new Set<string>();
  let subagentSpawns = 0;
  let cliVersion: string | null = null;
  const writeCountByFile = new Map<string, number>();
  let userPositive = 0, userNegative = 0, rephrases = 0;
  let lastUserText: string | null = null;
  let lastAssistantText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreateTokens = 0;
  let costUsd = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let numTurns = 0;
  let durationMs = 0;
  let stopReason: string | null = null;
  let isError = false;
  let startedAt = mtime;
  let lastEventAt = mtime;
  let pathBytes = 0;
  let lineCount = 0;
  let malformedLineCount = 0;
  let thinkingBlocks = 0;
  let textBlocks = 0;
  let attachmentCount = 0;
  let queueOperationCount = 0;
  let snapshotCount = 0;
  let hookErrors = 0;
  let messageCount = 0;
  let userType: string | null = null;
  let sawResult = false;
  let rootMessages = 0;
  let sidechainMessages = 0;
  let gitBranch: string | null = null;
  let entrypoint: string | null = null;
  const seenUuids = new Set<string>();
  const parentUuids = new Set<string>();
  const agentIds = new Set<string>();
  const toolNameById = new Map<string, string>();
  const toolCallsByName = new Map<string, number>();
  const toolStartByIdMs = new Map<string, number>();
  const toolDurationMs = new Map<string, number[]>();
  const toolErrorsByName = new Map<string, number>();
  const queueSummary: LiveQueueSummary = { enqueue: 0, dequeue: 0, remove: 0, popAll: 0, preview: [] };
  const touchedFiles = new Set<string>();
  const permissionModes: Record<string, number> = {};
  let readLikeOperations = 0;
  let writeLikeOperations = 0;
  let usageSegments: LiveUsageSegment[] = [];

  const metricSources: LiveMetricSources = {
    model: "missing",
    tokens: "missing",
    cost: "missing",
    duration: "missing",
    turns: "missing",
  };

  try {
    pathBytes = bytes;
    for (const line of lines) {
      if (!line.trim()) continue;
      lineCount++;
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        malformedLineCount++;
        continue;
      }

      const at = parseTimestamp(obj.timestamp) ?? parseTimestamp(obj.created_at) ?? null;
      if (at) {
        startedAt = Math.min(startedAt, at);
        lastEventAt = Math.max(lastEventAt, at);
      }

      if (typeof obj.uuid === "string") seenUuids.add(obj.uuid);
      if (typeof obj.parentUuid === "string" && obj.parentUuid) parentUuids.add(obj.parentUuid);
      if (obj.isSidechain === true) sidechainMessages++;
      if (obj.isSidechain === false) rootMessages++;
      if (typeof obj.agentId === "string") agentIds.add(obj.agentId);
      if (typeof obj.gitBranch === "string" && obj.gitBranch) gitBranch = obj.gitBranch;
      if (typeof obj.entrypoint === "string" && obj.entrypoint) entrypoint = obj.entrypoint;
      if (typeof obj.permissionMode === "string") incrementRecord(permissionModes, obj.permissionMode);
      if (typeof obj.sessionId === "string" && obj.sessionId) sessionId = obj.sessionId;
      if (typeof obj.cwd === "string" && obj.cwd) project = obj.cwd;
      if (typeof obj.userType === "string" && obj.userType) userType = obj.userType;
      if (typeof obj.version === "string" && obj.version) cliVersion = obj.version;

      // Human sentiment/rephrase — only real, short-ish user turns (skip
      // tool-results, injected <system-reminder>/command wrappers, pasted blobs).
      if (obj.type === "user" && obj.message && obj.isSidechain !== true) {
        const c = obj.message.content;
        const userText = typeof c === "string"
          ? c
          : Array.isArray(c) ? c.filter((b: any) => b?.type === "text").map((b: any) => b.text ?? "").join(" ") : "";
        const trimmed = userText.trim();
        // A claude-CLI-backed judge leaves its own session files; drop them.
        if (trimmed.startsWith(JUDGE_PROMPT_MARKER)) return null;
        if (trimmed && trimmed.length <= 600 && !trimmed.startsWith("<") && !trimmed.startsWith("Caveat:")) {
          const sent = classifySentiment(trimmed);
          if (sent === "positive") userPositive++;
          else if (sent === "negative") userNegative++;
          if (isRephrase(trimmed, lastUserText)) rephrases++;
          lastUserText = trimmed;
        }
      }

      if (obj.type === "system") {
        // "<synthetic>" is Claude Code's placeholder model on API-error turns,
        // not a real model — letting it win would misattribute (and mis-price)
        // the whole session's usage.
        if (typeof obj.model === "string" && obj.model && obj.model !== "<synthetic>") model = obj.model;
        sessionId = obj.sessionId ?? obj.session_id ?? sessionId;
        project = obj.cwd ?? obj.project ?? project;
        userType = obj.userType ?? userType;
        stopReason = obj.stopReason ?? stopReason;
        hookErrors += Number(obj.hookErrors ?? 0) || 0;
        messageCount = Math.max(messageCount, Number(obj.messageCount ?? 0) || 0);
        if (typeof obj.durationMs === "number") {
          durationMs = Math.max(durationMs, obj.durationMs);
          metricSources.duration = "measured";
        }
        if (typeof obj.totalDurationMs === "number") {
          durationMs = Math.max(durationMs, obj.totalDurationMs);
          metricSources.duration = "measured";
        }
      } else if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
        if (typeof obj.message?.model === "string" && obj.message.model && obj.message.model !== "<synthetic>") model = obj.message.model;
        const messageUsage = obj.message?.usage ?? {};
        const messageInput = numericOrNull(messageUsage.input_tokens);
        const messageOutput = numericOrNull(messageUsage.output_tokens);
        const messageCacheRead = numericOrNull(messageUsage.cache_read_input_tokens);
        const messageCacheCreate = numericOrNull(messageUsage.cache_creation_input_tokens);
        if (messageInput != null || messageOutput != null || messageCacheRead != null || messageCacheCreate != null) {
          const deltaInput = messageInput ?? 0;
          const deltaOutput = messageOutput ?? 0;
          inputTokens += deltaInput;
          outputTokens += deltaOutput;
          cacheReadTokens += messageCacheRead ?? 0;
          cacheCreateTokens += messageCacheCreate ?? 0;
          metricSources.tokens = "measured";
          if (at) {
            const elapsedSec = Math.max((at - startedAt) / 1000, 0.001);
            usageSegments.push({
              atMs: at,
              cumulativeInput: inputTokens,
              cumulativeOutput: outputTokens,
              deltaInput,
              deltaOutput,
              outTokPerSec: outputTokens / elapsedSec,
            });
          }
        }
        let assistantText = "";
        for (const b of obj.message.content) {
          if (b.type === "tool_use") {
            toolCalls++;
            if (typeof b.id === "string" && typeof b.name === "string") {
              toolNameById.set(b.id, b.name);
              if (at != null) toolStartByIdMs.set(b.id, at);
            }
            if (typeof b.name === "string") increment(toolCallsByName, b.name);
            for (const filePath of extractFilePaths(b.input)) touchedFiles.add(filePath);
            const rawName = String(b.name ?? "");
            const name = rawName.toLowerCase();
            if (["read", "grep", "glob", "webfetch", "websearch"].some((tool) => name.includes(tool))) readLikeOperations++;
            const isWrite = ["write", "edit", "multiedit"].some((tool) => name === tool || name.startsWith(tool));
            if (name.includes("write") || name.includes("edit")) writeLikeOperations++;
            // --- markers --- (subagent spawns are "Task" or "Agent" across versions)
            if (rawName === "Task" || rawName === "Agent") subagentSpawns++;
            if (rawName === "Skill") {
              const s = (b.input as any)?.skill ?? (b.input as any)?.command ?? (b.input as any)?.name;
              if (typeof s === "string" && s) skillsUsed.add(s);
            }
            const server = mcpServerFromTool(rawName);
            if (server) mcpServersUsed.add(server);
            // --- rework: count writes per file (a file rewritten 2+ times = churn) ---
            if (isWrite) {
              const fp = (b.input as any)?.file_path ?? (b.input as any)?.path;
              if (typeof fp === "string" && fp) writeCountByFile.set(fp, (writeCountByFile.get(fp) ?? 0) + 1);
            }
          }
          if (b.type === "thinking") thinkingBlocks++;
          if (b.type === "text") { textBlocks++; if (typeof b.text === "string") assistantText += b.text; }
        }
        if (assistantText.trim()) lastAssistantText = assistantText;
      } else if (obj.type === "user" && Array.isArray(obj.message?.content)) {
        for (const b of obj.message.content) {
          if (b.type === "tool_result") {
            const startMs = typeof b.tool_use_id === "string" ? toolStartByIdMs.get(b.tool_use_id) : undefined;
            if (startMs != null && at != null) {
              const delta = Math.max(0, at - startMs);
              const nm = toolNameById.get(b.tool_use_id as string) ?? "(unknown)";
              const list = toolDurationMs.get(nm) ?? [];
              list.push(delta);
              toolDurationMs.set(nm, list);
            }
            if (typeof b.tool_use_id === "string") toolStartByIdMs.delete(b.tool_use_id);
          }
          if (b.type === "tool_result" && b.is_error) {
            toolErrors++;
            increment(toolErrorsByName, toolNameById.get(b.tool_use_id) ?? "(unknown)");
          }
        }
      } else if (obj.type === "attachment") {
        attachmentCount++;
        for (const filePath of extractFilePaths(obj.attachment)) touchedFiles.add(filePath);
        const attachmentType = obj.attachment?.type;
        if (attachmentType === "edited_text_file") writeLikeOperations++;
      } else if (obj.type === "queue-operation") {
        queueOperationCount++;
        if (obj.operation === "enqueue") queueSummary.enqueue++;
        else if (obj.operation === "dequeue") queueSummary.dequeue++;
        else if (obj.operation === "remove") queueSummary.remove++;
        else if (obj.operation === "popAll") queueSummary.popAll++;
        if (typeof obj.content === "string" && queueSummary.preview.length < 3) queueSummary.preview.push(jsonPreview(obj.content, 220));
      } else if (obj.type === "file-history-snapshot") {
        snapshotCount++;
        for (const filePath of extractFilePaths(obj.snapshot)) touchedFiles.add(filePath);
      } else if (obj.type === "result") {
        sawResult = true;
        const usage = obj.usage || {};
        inputTokens = usage.input_tokens ?? inputTokens;
        outputTokens = usage.output_tokens ?? outputTokens;
        cacheReadTokens = usage.cache_read_input_tokens ?? cacheReadTokens;
        cacheCreateTokens = usage.cache_creation_input_tokens ?? cacheCreateTokens;
        costUsd = obj.total_cost_usd ?? costUsd;
        durationMs = obj.duration_ms ?? durationMs;
        numTurns = obj.num_turns ?? numTurns;
        stopReason = obj.stop_reason ?? stopReason;
        isError = !!obj.is_error;
        sessionId = obj.session_id ?? sessionId;
        if (usage.input_tokens != null || usage.output_tokens != null || usage.cache_read_input_tokens != null) metricSources.tokens = "measured";
        if (obj.total_cost_usd != null) metricSources.cost = "measured";
        if (obj.duration_ms != null) metricSources.duration = "measured";
        if (obj.num_turns != null) metricSources.turns = "measured";
      } else if (obj.type === "last-prompt") {
        if (typeof obj.lastPrompt === "string") lastPromptPreview = jsonPreview(obj.lastPrompt, 260);
      } else if (obj.type === "custom-title") {
        if (typeof obj.customTitle === "string") displayTitle = obj.customTitle;
      } else if (obj.type === "agent-name") {
        if (!displayTitle && typeof obj.agentName === "string") displayTitle = obj.agentName;
      }

      if (fields) {
        const f = fields;
        model = coalesceString(getPath(obj, f.model), model);
        sessionId = coalesceString(getPath(obj, f.sessionId), sessionId);
        const genericDuration = numericOrNull(getPath(obj, f.durationMs));
        if (genericDuration != null) {
          durationMs = Math.max(durationMs, genericDuration);
          metricSources.duration = "measured";
        }
        const genericInput = numericOrNull(getPath(obj, f.inputTokens));
        const genericOutput = numericOrNull(getPath(obj, f.outputTokens));
        const genericCacheRead = numericOrNull(getPath(obj, f.cacheReadTokens));
        const genericCacheCreate = numericOrNull(getPath(obj, f.cacheCreateTokens));
        if (genericInput != null || genericOutput != null || genericCacheRead != null || genericCacheCreate != null) {
          inputTokens = genericInput ?? inputTokens;
          outputTokens = genericOutput ?? outputTokens;
          cacheReadTokens = genericCacheRead ?? cacheReadTokens;
          cacheCreateTokens = genericCacheCreate ?? cacheCreateTokens;
          metricSources.tokens = "measured";
        }
        const genericCost = numericOrNull(getPath(obj, f.costUsd));
        if (genericCost != null) {
          costUsd = genericCost;
          metricSources.cost = "measured";
        }
        const genericTurns = numericOrNull(getPath(obj, f.numTurns));
        if (genericTurns != null) {
          numTurns = genericTurns;
          metricSources.turns = "measured";
        }
        stopReason = coalesceString(getPath(obj, f.stopReason), stopReason);
        const genericError = getPath(obj, f.isError);
        if (genericError != null) isError = Boolean(genericError);
      }
    }
  } catch {
    return null;
  }

  if (model) {
    metricSources.model = "measured";
  } else if (inferredModel) {
    model = inferredModel;
    metricSources.model = "inferred";
  }
  if (numTurns === 0 && messageCount > 0) {
    numTurns = messageCount;
    metricSources.turns = "inferred";
  } else if (numTurns > 0 && metricSources.turns === "missing") {
    metricSources.turns = sawResult ? "measured" : "inferred";
  }
  if (malformedLineCount > 0 && lineCount === malformedLineCount) {
    metricSources.model = "malformed";
    metricSources.tokens = "malformed";
    metricSources.cost = "malformed";
    metricSources.duration = "malformed";
    metricSources.turns = "malformed";
  }
  // Persisted session files carry token usage but no cost — estimate it from the
  // measured tokens + model list price. Tagged "inferred", never "measured".
  if (metricSources.cost === "missing") {
    const est = estimateCostUsd(model, { input: inputTokens, output: outputTokens, cacheRead: cacheReadTokens, cacheCreate: cacheCreateTokens });
    if (est != null) {
      costUsd = est;
      metricSources.cost = "inferred";
    }
  }

  const parseWarnings = buildWarnings(metricSources, malformedLineCount, lineCount, hookErrors, sawResult, model);
  const toolErrorRate = toolCalls > 0 ? toolErrors / toolCalls : 0;
  const toolCallsPerTurn = numTurns > 0 ? toolCalls / numTurns : 0;
  const textAvailability = lineCount > 0 ? textBlocks / lineCount : 0;
  const staleMs = Math.max(0, Date.now() - lastEventAt);
  const orphanMessages = [...parentUuids].filter((parentUuid) => !seenUuids.has(parentUuid)).length;
  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreateTokens;
  if (usageSegments.length === 0) {
    usageSegments = buildUsageSegments(startedAt, durationMs, inputTokens, outputTokens);
  }
  const toolSummaries = topEntries(toolCallsByName, 8).map(({ key, count }) => ({
    name: key,
    calls: count,
    errors: toolErrorsByName.get(key) ?? 0,
  }));
  const toolDurations = summarizeToolDurations(toolDurationMs, toolErrorsByName);

  return {
    sessionId: sessionId ?? path.basename(file, ".jsonl"),
    displayTitle,
    lastPromptPreview,
    project,
    model,
    startedAt,
    lastEventAt,
    durationMs,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreateTokens,
    totalTokens,
    costUsd,
    usageSegments,
    toolCalls,
    toolErrors,
    numTurns,
    stopReason,
    isError,
    pathBytes,
    path: file,
    lineCount,
    malformedLineCount,
    thinkingBlocks,
    textBlocks,
    attachmentCount,
    queueOperationCount,
    snapshotCount,
    hookErrors,
    messageCount,
    userType,
    dataQuality: scoreQuality(metricSources, malformedLineCount, lineCount, hookErrors, toolErrorRate),
    metricSources,
    parseWarnings,
    toolErrorRate,
    toolCallsPerTurn,
    textAvailability,
    staleMs,
    traceGraph: {
      rootMessages,
      sidechainMessages,
      agentCount: agentIds.size,
      orphanMessages,
    },
    toolSummaries,
    toolDurations,
    queueSummary,
    fileActivity: {
      touchedFiles: [...touchedFiles].sort().slice(0, 12),
      readLikeOperations,
      writeLikeOperations,
    },
    modeSummary: {
      permissionModes,
      gitBranch,
      entrypoint,
    },
    skillsUsed: [...skillsUsed].sort(),
    mcpServersUsed: [...mcpServersUsed].sort(),
    subagentSpawns,
    cliVersion,
    outcomeSignals: {
      userPositive,
      userNegative,
      rephrases,
      errorTail: isError || looksLikeApologyOrFailure(lastAssistantText),
      testsPassedTail: looksLikeTestsPassed(lastAssistantText),
      reworkFiles: [...writeCountByFile.values()].filter((n) => n >= 2).length,
    },
  };
}

export function summarizeCodexSessionFile(file: string, projectDir: string, mtime: number): LiveSession | null {
  return summarizeWithCache(file, projectDir, mtime, parseCodexSession);
}

/**
 * Orchestrator-injected persona preambles ("You are Worker 1 for …", "You are
 * `/root`, the primary agent in a team of agents …") arrive recorded as user
 * text in subagent sessions. They are plumbing, not the user's ask — using
 * them as titles/prompt previews leaks system-prompt text all over list UIs.
 * Short persona prompts a human might really type stay eligible.
 */
function isInjectedPersonaPreamble(text: string): boolean {
  const t = text.trimStart();
  if (t.startsWith("# AGENTS.md instructions")) return true; // harness-injected repo instructions
  return /^You are\b/.test(t) && t.length > 120;
}

function parseCodexSession(file: string, lines: Iterable<string>, bytes: number, projectDir: string, mtime: number): LiveSession | null {
  let sessionId: string | null = null;
  let displayTitle: string | null = null;
  let lastPromptPreview: string | null = null;
  let project = projectDir;
  let model: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreateTokens = 0;
  // Codex token accounting: sum per-turn usage (billed), not max-of-cumulative
  // (which undercounts sessions whose context was compacted/reset).
  let sumIn = 0, sumOut = 0, sumCached = 0, sawLast = false;
  let maxTotIn = 0, maxTotOut = 0, maxTotCached = 0;
  let userPositive = 0, userNegative = 0, rephrases = 0;
  let lastUserText: string | null = null;
  let lastAgentText = "";
  let toolCalls = 0;
  let toolErrors = 0;
  let messageCount = 0;
  let textBlocks = 0;
  let thinkingBlocks = 0;
  let startedAt = mtime;
  let lastEventAt = mtime;
  let pathBytes = 0;
  let lineCount = 0;
  let malformedLineCount = 0;
  let originator: string | null = null;
  let source: string | null = null;
  let cliVersion: string | null = null;
  const toolCallsByName = new Map<string, number>();
  const toolErrorsByName = new Map<string, number>();
  const toolStartByCallIdMs = new Map<string, number>();
  const toolNameByCallIdMs = new Map<string, string>();
  const toolDurationMs = new Map<string, number[]>();
  const touchedFiles = new Set<string>();
  const usageSegments: LiveUsageSegment[] = [];
  const metricSources: LiveMetricSources = {
    model: "missing",
    tokens: "missing",
    cost: "missing",
    duration: "inferred",
    turns: "inferred",
  };

  try {
    pathBytes = bytes;
    let previousInput = 0;
    let previousOutput = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      lineCount++;
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        malformedLineCount++;
        continue;
      }

      const at = parseTimestamp(obj.timestamp) ?? parseTimestamp(obj.payload?.timestamp) ?? null;
      if (at) {
        startedAt = Math.min(startedAt, at);
        lastEventAt = Math.max(lastEventAt, at);
      }

      if (obj.type === "session_meta") {
        const payload = obj.payload ?? {};
        sessionId = payload.id ?? payload.session_id ?? sessionId;
        project = payload.cwd ?? project;
        originator = payload.originator ?? originator;
        source = payload.source ?? source;
        cliVersion = payload.cli_version ?? cliVersion;
        model = payload.model ?? payload.model_slug ?? model;
        displayTitle = displayTitle ?? payload.thread_name ?? null;
        if (payload.model || payload.model_slug) metricSources.model = "measured";
      } else if (obj.type === "turn_context") {
        const payload = obj.payload ?? {};
        project = payload.cwd ?? project;
        displayTitle = displayTitle ?? payload.thread_name ?? payload.title ?? null;
        // Codex records the model per turn here, not in session_meta — reading
        // only session_meta left every Codex session's model "unknown".
        if (payload.model || payload.model_slug) {
          model = payload.model ?? payload.model_slug ?? model;
          metricSources.model = "measured";
        }
      } else if (obj.type === "event_msg") {
        const payload = obj.payload ?? {};
        if (payload.type === "agent_message" && typeof payload.message === "string") {
          textBlocks++;
          messageCount++;
          displayTitle = displayTitle ?? jsonPreview(payload.message, 80);
          lastAgentText = payload.message;
        } else if (payload.type === "user_message" && typeof payload.message === "string") {
          if (payload.message.trim().startsWith(JUDGE_PROMPT_MARKER)) return null; // judge stub, not user work
        } else if (payload.type === "token_count") {
          const info = payload.info ?? {};
          const last = info.last_token_usage;
          const tot = info.total_token_usage;
          if (last) {
            sawLast = true;
            sumIn += Number(last.input_tokens ?? 0) || 0;
            sumOut += Number(last.output_tokens ?? 0) || 0;
            sumCached += Number(last.cached_input_tokens ?? 0) || 0;
          }
          if (tot) {
            maxTotIn = Math.max(maxTotIn, Number(tot.input_tokens ?? 0) || 0);
            maxTotOut = Math.max(maxTotOut, Number(tot.output_tokens ?? 0) || 0);
            maxTotCached = Math.max(maxTotCached, Number(tot.cached_input_tokens ?? 0) || 0);
          }
          metricSources.tokens = "measured";
          if (at && tot) {
            const cin = Number(tot.input_tokens ?? 0) || 0;
            const cout = Number(tot.output_tokens ?? 0) || 0;
            const elapsedSec = Math.max((at - startedAt) / 1000, 0.001);
            usageSegments.push({
              atMs: at,
              cumulativeInput: cin,
              cumulativeOutput: cout,
              deltaInput: Math.max(0, cin - previousInput),
              deltaOutput: Math.max(0, cout - previousOutput),
              outTokPerSec: cout / elapsedSec,
            });
            previousInput = cin;
            previousOutput = cout;
          }
        }
      } else if (obj.type === "response_item") {
        const payload = obj.payload ?? {};
        if (payload.type === "reasoning") thinkingBlocks++;
        if (payload.type === "message") {
          textBlocks++;
          messageCount++;
          const text = Array.isArray(payload.content)
            ? payload.content.map((item: any) => item.text).filter(Boolean).join(" ")
            : "";
          // OpenEval's own CLI-backed judge invocations leave codex_exec stub
          // sessions behind; they are instrumentation, not user work.
          if (payload.role === "user" && text.trim().startsWith(JUDGE_PROMPT_MARKER)) return null;
          // Injected wrappers ("<permissions instructions>", "<environment_context>")
          // and orchestrator persona preambles make useless titles — wait for
          // the first real message.
          if (text && !text.trim().startsWith("<") && !isInjectedPersonaPreamble(text)) displayTitle = displayTitle ?? jsonPreview(text, 80);
        }
        if (payload.type === "function_call") {
          toolCalls++;
          const name = String(payload.name ?? "(unknown)");
          increment(toolCallsByName, name);
          extractFilePaths(payload.arguments, touchedFiles);
          if (typeof payload.call_id === "string" && at != null) {
            toolStartByCallIdMs.set(payload.call_id, at);
            toolNameByCallIdMs.set(payload.call_id, name);
          }
        }
        if (payload.type === "function_call_output") {
          const output = String(payload.output ?? "");
          extractFilePaths(output, touchedFiles);
          const errored = looksLikeToolError(output);
          if (typeof payload.call_id === "string") {
            const startMs = toolStartByCallIdMs.get(payload.call_id);
            if (startMs != null && at != null) {
              const delta = Math.max(0, at - startMs);
              const nm = toolNameByCallIdMs.get(payload.call_id) ?? "(unknown)";
              const list = toolDurationMs.get(nm) ?? [];
              list.push(delta);
              toolDurationMs.set(nm, list);
            }
            if (errored) {
              toolErrors++;
              increment(toolErrorsByName, toolNameByCallIdMs.get(payload.call_id) ?? "(unknown)");
            }
            toolStartByCallIdMs.delete(payload.call_id);
            toolNameByCallIdMs.delete(payload.call_id);
          } else if (errored) {
            toolErrors++;
            increment(toolErrorsByName, "(unknown)");
          }
        }
      } else if (obj.type === "user_msg" || obj.type === "user_message") {
        const text = String(obj.payload?.message ?? obj.payload?.text ?? obj.message ?? obj.text ?? "");
        if (text && !text.trim().startsWith("<") && !isInjectedPersonaPreamble(text)) lastPromptPreview = jsonPreview(text, 260);
        const trimmed = text.trim();
        if (trimmed && trimmed.length <= 600 && !trimmed.startsWith("<")) {
          const sent = classifySentiment(trimmed);
          if (sent === "positive") userPositive++;
          else if (sent === "negative") userNegative++;
          if (isRephrase(trimmed, lastUserText)) rephrases++;
          lastUserText = trimmed;
        }
      }
    }
  } catch {
    return null;
  }

  // Finalize tokens. Codex `input_tokens` INCLUDES the cached portion, so split
  // fresh = input − cached and report cacheRead = cached — otherwise input and
  // cacheRead double-count. Prefer summed per-turn usage; fall back to cumulative.
  {
    const totIn = sawLast ? sumIn : maxTotIn;
    const totOut = sawLast ? sumOut : maxTotOut;
    const cached = sawLast ? sumCached : maxTotCached;
    cacheReadTokens = cached;
    inputTokens = Math.max(0, totIn - cached);
    outputTokens = totOut;
  }

  const durationMs = Math.max(0, lastEventAt - startedAt);
  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreateTokens;
  const toolSummaries = topEntries(toolCallsByName, 8).map(({ key, count }) => ({
    name: key,
    calls: count,
    errors: toolErrorsByName.get(key) ?? 0,
  }));
  const toolDurations = summarizeToolDurations(toolDurationMs, toolErrorsByName);
  // Codex session files carry no cost — estimate from measured tokens + model.
  let costUsd = 0;
  const estCost = estimateCostUsd(model, { input: inputTokens, output: outputTokens, cacheRead: cacheReadTokens, cacheCreate: cacheCreateTokens });
  if (estCost != null) {
    costUsd = estCost;
    metricSources.cost = "inferred";
  }

  const parseWarnings = buildWarnings(metricSources, malformedLineCount, lineCount, 0, true);
  if (originator) parseWarnings.push(`source: ${originator}${source ? ` / ${source}` : ""}${cliVersion ? ` ${cliVersion}` : ""}`);
  const toolErrorRate = toolCalls > 0 ? toolErrors / toolCalls : 0;

  return {
    sessionId: sessionId ?? path.basename(file, ".jsonl"),
    displayTitle,
    lastPromptPreview,
    project,
    model,
    startedAt,
    lastEventAt,
    durationMs,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreateTokens,
    totalTokens,
    costUsd,
    usageSegments,
    toolCalls,
    toolErrors,
    numTurns: Math.max(messageCount, 1),
    stopReason: null,
    isError: toolErrors > 0,
    pathBytes,
    path: file,
    lineCount,
    malformedLineCount,
    thinkingBlocks,
    textBlocks,
    attachmentCount: 0,
    queueOperationCount: 0,
    snapshotCount: 0,
    hookErrors: 0,
    messageCount,
    userType: originator ?? source,
    dataQuality: scoreQuality(metricSources, malformedLineCount, lineCount, 0, toolErrorRate),
    metricSources,
    parseWarnings,
    toolErrorRate,
    toolCallsPerTurn: messageCount > 0 ? toolCalls / messageCount : toolCalls,
    textAvailability: lineCount > 0 ? textBlocks / lineCount : 0,
    staleMs: Math.max(0, Date.now() - lastEventAt),
    traceGraph: {
      rootMessages: messageCount,
      sidechainMessages: 0,
      agentCount: 0,
      orphanMessages: 0,
    },
    toolSummaries,
    toolDurations,
    queueSummary: { enqueue: 0, dequeue: 0, remove: 0, popAll: 0, preview: [] },
    fileActivity: {
      touchedFiles: [...touchedFiles].sort().slice(0, 12),
      readLikeOperations: toolSummaries.filter((tool) => /read|grep|search|find|open/i.test(tool.name)).reduce((sum, tool) => sum + tool.calls, 0),
      writeLikeOperations: toolSummaries.filter((tool) => /write|edit|patch|apply/i.test(tool.name)).reduce((sum, tool) => sum + tool.calls, 0),
    },
    modeSummary: {
      permissionModes: {},
      gitBranch: null,
      entrypoint: source ?? originator,
    },
    skillsUsed: [],
    mcpServersUsed: [],
    subagentSpawns: 0,
    cliVersion,
    outcomeSignals: {
      userPositive,
      userNegative,
      rephrases,
      errorTail: looksLikeApologyOrFailure(lastAgentText),
      testsPassedTail: looksLikeTestsPassed(lastAgentText),
      reworkFiles: 0,
    },
  };
}

function buildWarnings(sources: LiveMetricSources, malformedLineCount: number, lineCount: number, hookErrors: number, sawResult: boolean, model?: string | null): string[] {
  const warnings: string[] = [];
  if (sources.model === "missing") warnings.push("model missing from trace");
  if (sources.model === "inferred") warnings.push(`model inferred as ${model ?? "unknown"} from the harness descriptor's liveTrace default`);
  if (sources.tokens === "missing") warnings.push("token usage missing from trace");
  if (sources.cost === "missing") warnings.push("cost missing from trace");
  if (sources.duration === "missing") warnings.push("duration missing from trace");
  if (sources.turns === "inferred") warnings.push("turn count inferred from messageCount");
  if (!sawResult) warnings.push("no final result event found");
  if (malformedLineCount > 0) warnings.push(`${malformedLineCount}/${lineCount} malformed line(s) skipped`);
  if (hookErrors > 0) warnings.push(`${hookErrors} hook error(s) reported`);
  return warnings;
}

function coalesceString(value: unknown, fallback: string | null): string | null {
  if (typeof value === "string" && value) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function numericOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildUsageSegments(startedAt: number, durationMs: number, inputTokens: number, outputTokens: number): LiveUsageSegment[] {
  if (inputTokens <= 0 && outputTokens <= 0) return [];
  const elapsedSec = Math.max(durationMs / 1000, 0.001);
  return [{
    atMs: startedAt + Math.max(durationMs, 0),
    cumulativeInput: inputTokens,
    cumulativeOutput: outputTokens,
    deltaInput: inputTokens,
    deltaOutput: outputTokens,
    outTokPerSec: outputTokens / elapsedSec,
  }];
}

function scoreQuality(sources: LiveMetricSources, malformedLineCount: number, lineCount: number, hookErrors: number, toolErrorRate: number): number {
  let score = 100;
  if (metricMissing(sources.model)) score -= 12;
  if (metricMissing(sources.tokens)) score -= 14;
  if (metricMissing(sources.cost)) score -= 8;
  if (metricMissing(sources.duration)) score -= 12;
  if (sources.turns === "missing") score -= 8;
  if (sources.turns === "inferred") score -= 3;
  if (malformedLineCount > 0) score -= Math.min(20, Math.ceil((malformedLineCount / Math.max(lineCount, 1)) * 100));
  if (hookErrors > 0) score -= Math.min(12, hookErrors * 2);
  if (toolErrorRate > 0.25) score -= 6;
  return Math.max(0, Math.min(100, score));
}

/** Joined text of an OpenAI/Anthropic-style content array (input_text / output_text / text blocks). */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b: any) => (typeof b === "string" ? b : typeof b?.text === "string" ? b.text : ""))
    .filter(Boolean)
    .join("\n");
}

/** Tool-call arguments as a compact one-liner (parsed when JSON, verbatim otherwise). */
function argsPreview(args: unknown, max = 420): string {
  if (typeof args !== "string") return jsonPreview(args ?? {}, max);
  try { return jsonPreview(JSON.parse(args), max); } catch { return jsonPreview(args, max); }
}

function toTranscriptTurn(obj: any, index: number): LiveTranscriptTurn {
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
      }),
    };
  }

  if (type === "event_msg") {
    const payload = obj.payload ?? {};
    if (payload.type === "agent_message") {
      return { type, subtype: payload.type, severity: "info", at, role: "assistant", label: "Assistant", preview: jsonPreview(payload.message ?? "") };
    }
    if (payload.type === "user_message") {
      return { type, subtype: payload.type, severity: "info", at, role: "user", label: "You", preview: jsonPreview(payload.message ?? "") };
    }
    return {
      type,
      subtype: payload.type,
      severity: "info",
      at,
      role: "meta",
      label: payload.type === "token_count" ? "Usage" : `Event: ${payload.type ?? index}`,
      preview: jsonPreview(payload.type === "token_count" ? payload.info?.total_token_usage ?? payload.info : payload.message ?? payload),
    };
  }

  if (type === "response_item") {
    const payload = obj.payload ?? {};
    if (payload.type === "message") {
      const role = String(payload.role ?? "");
      const text = contentText(payload.content);
      if (role === "assistant") return { type, subtype: "message", severity: "info", at, role: "assistant", label: "Assistant", preview: jsonPreview(text) };
      if (role === "user") return { type, subtype: "message", severity: "info", at, role: "user", label: "You", preview: jsonPreview(text) };
      // developer/system prompts are plumbing, not conversation
      return { type, subtype: "message", severity: "info", at, role: "meta", label: `${role || "message"} prompt`, preview: jsonPreview(text) };
    }
    if (payload.type === "function_call") {
      return {
        type, subtype: payload.type, severity: "info", at, role: "tool",
        label: `Tool: ${payload.name ?? "(unknown)"}`,
        preview: argsPreview(payload.arguments),
      };
    }
    if (payload.type === "function_call_output") {
      const out = String(payload.output ?? "");
      const errored = looksLikeToolError(out);
      return { type, subtype: payload.type, severity: errored ? "error" : "info", at, role: "tool", label: errored ? "Tool output — error" : "Tool output", preview: jsonPreview(out) };
    }
    if (payload.type === "reasoning") {
      const summary = contentText(payload.summary) || contentText(payload.content);
      return { type, subtype: payload.type, severity: "info", at, role: "assistant", label: "Reasoning", preview: jsonPreview(summary || "(encrypted reasoning)") };
    }
    return { type, subtype: payload.type, severity: "info", at, role: "meta", label: `Response: ${payload.type ?? "item"}`, preview: jsonPreview(payload) };
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
      return {
        type, subtype, severity: "info", at, role: "tool",
        label: `Tool: ${names.join(", ") || "(unknown)"}`,
        preview: argsPreview(tools[0]?.input),
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

function emptyUsageSummary(): LiveUsageSummary {
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreateTokens: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    sessionsWithMeasuredUsage: 0,
    sessionsWithMeasuredCost: 0,
    tokenCoverage: 0,
    costCoverage: 0,
    avgOutputTokPerSec: 0,
  };
}

function aggregate(sessions: LiveSession[], scanWarnings: string[] = [], source: LiveTraceSource = resolveLiveSource()): LiveAggregate {
  const byModelMap = new Map<string, {
    model: string;
    sessions: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    toolCalls: number;
    errors: number;
    totalDur: number;
    totalQuality: number;
    missingTokens: number;
    missingCost: number;
  }>();
  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreateTokens = 0;
  let totalToolCalls = 0;
  let totalToolErrors = 0;
  let totalQuality = 0;
  const projects = new Set<string>();
  const toolCallsByName = new Map<string, number>();
  const toolErrorsByName = new Map<string, number>();
  const branchSessions = new Map<string, number>();
  const fileSessions = new Map<string, number>();
  const queueTotals: LiveQueueSummary = { enqueue: 0, dequeue: 0, remove: 0, popAll: 0, preview: [] };
  let sidechainMessages = 0;
  let agentSessions = 0;
  let outputTokPerSecTotal = 0;
  let outputTokPerSecCount = 0;

  for (const s of sessions) {
    projects.add(s.project);
    totalCostUsd += s.costUsd;
    totalInputTokens += s.inputTokens;
    totalOutputTokens += s.outputTokens;
    totalCacheReadTokens += s.cacheReadTokens;
    totalCacheCreateTokens += s.cacheCreateTokens;
    totalToolCalls += s.toolCalls;
    totalToolErrors += s.toolErrors;
    totalQuality += s.dataQuality;
    sidechainMessages += s.traceGraph.sidechainMessages;
    if (s.traceGraph.agentCount > 0) agentSessions++;
    if (s.metricSources.tokens === "measured" && s.outputTokens > 0 && s.durationMs > 0) {
      outputTokPerSecTotal += s.outputTokens / Math.max(s.durationMs / 1000, 0.001);
      outputTokPerSecCount++;
    }
    if (s.modeSummary.gitBranch) increment(branchSessions, s.modeSummary.gitBranch);
    queueTotals.enqueue += s.queueSummary.enqueue;
    queueTotals.dequeue += s.queueSummary.dequeue;
    queueTotals.remove += s.queueSummary.remove;
    queueTotals.popAll += s.queueSummary.popAll;
    if (queueTotals.preview.length < 5) queueTotals.preview.push(...s.queueSummary.preview.slice(0, 5 - queueTotals.preview.length));
    for (const tool of s.toolSummaries) {
      increment(toolCallsByName, tool.name, tool.calls);
      increment(toolErrorsByName, tool.name, tool.errors);
    }
    for (const file of s.fileActivity.touchedFiles) increment(fileSessions, file);
    const key = s.model || "unknown";
    const cur = byModelMap.get(key) || { model: key, sessions: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, toolCalls: 0, errors: 0, totalDur: 0, totalQuality: 0, missingTokens: 0, missingCost: 0 };
    cur.sessions++;
    cur.costUsd += s.costUsd;
    cur.inputTokens += s.inputTokens;
    cur.outputTokens += s.outputTokens;
    cur.cacheReadTokens += s.cacheReadTokens;
    cur.toolCalls += s.toolCalls;
    cur.errors += s.toolErrors;
    cur.totalDur += s.durationMs;
    cur.totalQuality += s.dataQuality;
    if (s.metricSources.tokens === "missing") cur.missingTokens++;
    if (s.metricSources.cost === "missing") cur.missingCost++;
    byModelMap.set(key, cur);
  }

  const byModel = Array.from(byModelMap.values()).map((m) => ({
    model: m.model,
    sessions: m.sessions,
    costUsd: m.costUsd,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    cacheReadTokens: m.cacheReadTokens,
    toolCalls: m.toolCalls,
    errors: m.errors,
    avgDurationMs: m.sessions ? m.totalDur / m.sessions : 0,
    avgDataQuality: m.sessions ? m.totalQuality / m.sessions : 0,
    missingTokens: m.missingTokens,
    missingCost: m.missingCost,
  })).sort((a, b) => b.errors - a.errors || a.avgDataQuality - b.avgDataQuality);

  const usageSummary = emptyUsageSummary();
  usageSummary.totalInputTokens = totalInputTokens;
  usageSummary.totalOutputTokens = totalOutputTokens;
  usageSummary.totalCacheReadTokens = totalCacheReadTokens;
  usageSummary.totalCacheCreateTokens = totalCacheCreateTokens;
  usageSummary.totalTokens = totalInputTokens + totalOutputTokens + totalCacheReadTokens + totalCacheCreateTokens;
  usageSummary.totalCostUsd = totalCostUsd;
  usageSummary.sessionsWithMeasuredUsage = sessions.filter((s) => s.metricSources.tokens === "measured").length;
  usageSummary.sessionsWithMeasuredCost = sessions.filter((s) => s.metricSources.cost === "measured").length;
  usageSummary.tokenCoverage = sessions.length ? usageSummary.sessionsWithMeasuredUsage / sessions.length : 0;
  usageSummary.costCoverage = sessions.length ? usageSummary.sessionsWithMeasuredCost / sessions.length : 0;
  usageSummary.avgOutputTokPerSec = outputTokPerSecCount ? outputTokPerSecTotal / outputTokPerSecCount : 0;

  return {
    sourceHarness: source.id,
    sourceLabel: source.label,
    sourceStatus: source.status,
    sourceRoots: source.roots,
    sourceMessage: source.message,
    usageSummary,
    totalSessions: sessions.length,
    totalProjects: projects.size,
    totalCostUsd,
    totalInputTokens,
    totalOutputTokens,
    totalToolCalls,
    totalToolErrors,
    sessionsWithMeasuredDuration: sessions.filter((s) => s.metricSources.duration === "measured").length,
    sessionsWithMissingModel: sessions.filter((s) => s.metricSources.model === "missing").length,
    sessionsWithInferredModel: sessions.filter((s) => s.metricSources.model === "inferred").length,
    sessionsWithMissingTokens: sessions.filter((s) => s.metricSources.tokens === "missing").length,
    sessionsWithInferredCost: sessions.filter((s) => s.metricSources.cost === "inferred").length,
    archivedSessions: sessions.filter((s) => s.archived).length,
    sessionsWithMalformedLines: sessions.filter((s) => s.malformedLineCount > 0).length,
    staleSessions: sessions.filter((s) => s.staleMs > 1000 * 60 * 60 * 12).length,
    avgDataQuality: sessions.length ? totalQuality / sessions.length : 0,
    scanWarnings,
    byModel,
    byTool: topEntries(toolCallsByName, 10).map(({ key, count }) => ({
      name: key,
      calls: count,
      errors: toolErrorsByName.get(key) ?? 0,
    })),
    queueTotals,
    sidechainMessages,
    agentSessions,
    topBranches: topEntries(branchSessions, 8).map(({ key, count }) => ({ branch: key, sessions: count })),
    topFiles: topEntries(fileSessions, 10).map(({ key, count }) => ({ file: key, sessions: count })),
    sessions: sessions.slice(0, 100),
  };
}
