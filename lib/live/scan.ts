import { parseAgentDbSessions } from "./parse-agent-db";
import fs from "node:fs";
import path from "node:path";
import { getCachedSessionRows, listCachedFilesUnder, PARSER_VERSION } from "../live-cache";
import { estimateCostUsd } from "../pricing";
import type { CollectedSourceFiles, CollectionSourceSpec, LiveAggregate, LiveAggregateList, LiveScanCoverage, LiveSession, LiveSessionListItem, LiveTraceSource } from "./types";
import { resolveLiveSource, specToSource } from "./sources";
import { summarizeCodexSessionFile, summarizeHermesSessionFile, summarizeLiveSessionFile } from "./summarize";
import { parseHermesDbSource, resolveHermesDbSessionDetail } from "./parse-hermes-db";
import { aggregate } from "./aggregate";
import { attributedModelUsage, estimateModelUsageCost } from "./util";

type SourceFile = { file: string; project: string; mtime: number; size: number };
type BoundaryEvidence = "match" | "complete" | "unknown";

const DUPLICATE_WARNING_PREFIX = "Duplicate transcript entries";
const DEPTH_PROBE_ENTRY_CAP = 2048;

function sourceFileIdentity(file: string): string {
  try { return fs.realpathSync(file); } catch { return path.resolve(file); }
}

function compareSourceFiles(a: SourceFile, b: SourceFile): number {
  return a.file.localeCompare(b.file) || a.project.localeCompare(b.project);
}

/**
 * A depth cap is an evidence boundary, not proof that the omitted subtree is
 * empty. Probe only directory entries below that boundary, with a small shared
 * budget, so matching files are surfaced without reading transcript contents.
 */
function probeForMatchingFileBelow(
  dir: string,
  matches: (name: string) => boolean,
  budget: { remaining: number },
): BoundaryEvidence {
  if (budget.remaining <= 0) return "unknown";
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return "unknown";
  }
  let sawUnknown = false;
  for (const entry of entries) {
    if (budget.remaining <= 0) return "unknown";
    budget.remaining--;
    const full = path.join(dir, entry.name);
    if (entry.isFile() && matches(entry.name)) return "match";
    if (!entry.isDirectory()) continue;
    const nested = probeForMatchingFileBelow(full, matches, budget);
    if (nested === "match") return "match";
    if (nested === "unknown") sawUnknown = true;
  }
  return sawUnknown ? "unknown" : "complete";
}

function addDepthBoundaryWarning(scanWarnings: string[], dir: string, evidence: BoundaryEvidence): void {
  if (evidence === "complete") return;
  const detail = evidence === "match"
    ? "matching transcript files may exist below it"
    : "the remaining subtree could not be proven empty";
  addScanWarning(scanWarnings, `Scan depth boundary at ${dir}; ${detail}`);
}

/** Session files for a source, without parsing them — cheap discovery counts. */
export function listSourceFiles(spec: CollectionSourceSpec): Array<{ file: string; project: string; mtime: number; size: number }> {
  return collectLiveTraceFiles(specToSource(spec), []);
}

/**
 * One walk, reusable: discovery (counts, last activity) and the scan itself
 * both need the file list, and a Collection pass used to walk every source
 * tree twice to get it. Pass the result to scanSourceSessions as
 * `preCollected` to reuse the walk (warnings included, so output matches a
 * scan that walked for itself).
 */
export function collectSourceFiles(spec: CollectionSourceSpec): CollectedSourceFiles {
  const scanWarnings: string[] = [];
  const files = collectLiveTraceFiles(specToSource(spec), scanWarnings);
  return { files, scanWarnings };
}

/**
 * Scan one arbitrary collection source (any harness), reusing the harness path.
 * `sessionRetention` widens the aggregate's display-capped `sessions` field
 * (default 100) for callers that browse full history; totals are unaffected.
 * `reparseFiles` lists files whose CONTENT changed under an unchanged
 * (mtime, size) stat tuple — both parse-cache tiers key on that tuple, so a
 * listed file must skip them, re-parse, and overwrite the stale cached row.
 */
export function scanSourceSessions(spec: CollectionSourceSpec, limit = 200, opts: { includeArchived?: boolean; preCollected?: CollectedSourceFiles; sessionRetention?: number; reparseFiles?: ReadonlySet<string> } = {}): LiveAggregate {
  return scanResolvedSource(specToSource(spec), limit, opts.includeArchived ?? false, opts.preCollected, opts.sessionRetention, opts.reparseFiles);
}

export function scanLiveSessions(limit = 200, harness?: string): LiveAggregate {
  return scanResolvedSource(resolveLiveSource(harness), limit);
}

const LIST_USAGE_RATE_SAMPLES = 24;

/**
 * Project a parsed session down to the fields the list/table and signature
 * need. Drawer-only arrays are intentionally not copied into this object.
 */
export function projectLiveSession(session: LiveSession): LiveSessionListItem {
  const { usageSegments, modelUsage: _modelUsage, lastPromptPreview: _lastPromptPreview, toolSummaries: _toolSummaries, toolDurations: _toolDurations, queueSummary: _queueSummary, fileActivity: _fileActivity, skillsUsed: _skillsUsed, mcpServersUsed: _mcpServersUsed, subagentSpawns: _subagentSpawns, cliVersion: _cliVersion, outcomeSignals: _outcomeSignals, staleMs: _staleMs, ...scalarFields } = session;
  const usageRates = usageSegments.length === 0
    ? []
    : usageSegments.length <= LIST_USAGE_RATE_SAMPLES
      ? usageSegments.map((segment) => segment.outTokPerSec)
      : Array.from({ length: LIST_USAGE_RATE_SAMPLES }, (_, index) => {
          const sourceIndex = Math.round(index * (usageSegments.length - 1) / (LIST_USAGE_RATE_SAMPLES - 1));
          return usageSegments[sourceIndex]?.outTokPerSec ?? 0;
        });
  return {
    ...scalarFields,
    traceGraph: { ...session.traceGraph },
    modeSummary: { gitBranch: session.modeSummary.gitBranch },
    usageRates,
  };
}

/** Return an aggregate with lean session rows for SSR/API transport. */
export function projectLiveAggregate(data: LiveAggregate): LiveAggregateList {
  return { ...data, sessions: data.sessions.map(projectLiveSession) };
}

function projectDirForDetail(source: LiveTraceSource, file: string): string {
  for (const root of source.roots) {
    const rel = path.relative(path.resolve(root), file);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    if (source.format === "claude-projects") return rel.split(path.sep)[0] || path.basename(path.dirname(file));
    return path.dirname(rel) || path.basename(root);
  }
  return path.basename(path.dirname(file));
}

export interface ResolvedLiveSessionFile {
  file: string;
  project: string;
  mtime: number;
  size: number;
  source: LiveTraceSource;
}

/**
 * Resolve a client-returned session path through the server's current source
 * inventory. The requested string is used only as an equality key; every
 * filesystem operation receives the path and stat produced by the trusted
 * descriptor-root walk. This also rejects symlinks because the collector
 * admits regular directory entries only.
 *
 * DB-backed formats (hermes-sqlite) expand one file to many sessions, so the
 * drawer passes `sessionId` to select within the expanded set; the file path
 * alone cannot identify a session there.
 */
export function resolveLiveSessionFile(filePath: string, harness?: string, sessionId?: string): ResolvedLiveSessionFile | null {
  // Server actions are callable from an untrusted browser. Reject malformed or
  // absurdly long path values before path.resolve and the source walk.
  if (typeof filePath !== "string" || filePath.length === 0 || filePath.length > 4096) return null;
  const source = resolveLiveSource(harness);
  if (source.status !== "available") return null;
  const requested = path.resolve(filePath);
  const expectedExtension = source.format === "hermes-json" ? ".json" : source.format === "hermes-sqlite" ? ".db" : ".jsonl";
  if (!requested.endsWith(expectedExtension)) return null;
  const match = collectLiveTraceFiles(source, []).find((candidate) => path.resolve(candidate.file) === requested);
  if (!match) return null;
  // A sessionId-scoped request must be truthful: the named session must exist
  // in this DB's current expansion, otherwise the request is rejected rather
  // than resolving to "the DB happens to contain it later".
  if (sessionId != null) {
    if (source.format !== "hermes-sqlite") return null;
    if (typeof sessionId !== "string" || !sessionId || sessionId.length > 512) return null;
    const expanded = parseHermesDbSource([match]);
    if (!expanded.some((session) => session.sessionId === sessionId)) return null;
  }
  return { ...match, source };
}

/**
 * Parse one complete session on demand for the drawer. The source/path check is
 * deliberately repeated against the current server-side inventory rather than
 * trusting the client-returned absolute path. DB-backed sessions additionally
 * require the sessionId that scopes one session out of the DB expansion.
 */
export function readLiveSessionDetail(filePath: string, harness?: string, sessionId?: string): LiveSession | null {
  const resolved = resolveLiveSessionFile(filePath, harness, sessionId);
  if (!resolved) return null;
  const { file, mtime, size, source } = resolved;
  const projectDir = projectDirForDetail(source, file);
  const stat = { mtimeMs: mtime, size };
  const session = source.format === "codex-sessions"
    ? summarizeCodexSessionFile(file, projectDir, mtime, stat)
    : source.format === "hermes-json"
      ? summarizeHermesSessionFile(file, projectDir, mtime, stat)
      : source.format === "hermes-sqlite"
        ? resolveHermesDbSessionDetail(file, sessionId ?? "", projectDir)
        : summarizeLiveSessionFile(file, projectDir, mtime, {
          fields: source.fields,
          inferredModel: source.inferredModel,
          decodeProject: source.format !== "jsonl-dir",
          sourceFormat: source.format,
          stat,
        });
  return session ? refreshInferredSessionCost(session) : null;
}

function parseSourceSessionList(
  source: LiveTraceSource,
  limit: number,
  scanWarnings: string[],
  includeArchived = false,
  preCollected?: CollectedSourceFiles,
  reparseFiles?: ReadonlySet<string>,
): { sessions: LiveSession[]; coverage: LiveScanCoverage } {
  const sessions: LiveSession[] = [];
  if (source.status !== "available") {
    return {
      sessions,
      coverage: {
        requestedLimit: limit,
        discoveredFiles: 0,
        scannedFiles: 0,
        parsedFiles: 0,
        droppedFiles: 0,
        unscannedFiles: 0,
        archivedSessionsAdded: 0,
        truncated: false,
        partial: true,
      },
    };
  }
  // Hermes' SQLite ledger expands to the FULL session list — one file cannot
  // flow through the one-file-one-session loop below. Profiles keep separate
  // ledgers (~/.hermes/profiles/<name>/state.db), so every discovered DB is
  // parsed and the id-deduped merge wins.
  if (source.format === "hermes-sqlite" || source.format === "agent-sqlite") {
    const files = preCollected ? [...preCollected.files] : collectLiveTraceFiles(source, scanWarnings);
    files.sort((a, b) => b.mtime - a.mtime || a.file.localeCompare(b.file));
    if (files.length === 0) {
      return {
        sessions,
        coverage: { requestedLimit: limit, discoveredFiles: 0, scannedFiles: 0, parsedFiles: 0, droppedFiles: 0, unscannedFiles: 0, archivedSessionsAdded: 0, truncated: false, partial: false },
      };
    }
    let failedFiles = 0;
    const all = source.format === "hermes-sqlite" ? parseHermesDbSource(files) : files.flatMap(file => {
      try { return parseAgentDbSessions(file.file); } catch (error) { failedFiles++; scanWarnings.push(error instanceof Error ? error.message : String(error)); return []; }
    });
    sessions.push(...all.slice(0, limit).map(refreshInferredSessionCost));
    return {
      sessions,
      coverage: { requestedLimit: limit, discoveredFiles: files.length, scannedFiles: files.length, parsedFiles: files.length - failedFiles, droppedFiles: failedFiles, unscannedFiles: 0, archivedSessionsAdded: 0, truncated: all.length > limit, partial: failedFiles > 0 },
    };
  }
  let files: SourceFile[];
  if (preCollected) {
    // Copy before sorting — the caller may share the collected list.
    files = [...preCollected.files];
    scanWarnings.push(...preCollected.scanWarnings);
  } else {
    files = collectLiveTraceFiles(source, scanWarnings);
  }
  // Files written in the same millisecond are common in append-heavy traces;
  // tie-break by path so the bounded slice and its signature are deterministic.
  files.sort((a, b) => b.mtime - a.mtime || a.file.localeCompare(b.file));
  // Parse-dropped files (judge rollouts, stub sessions → null) must not consume
  // result slots: keep consuming older files until `limit` sessions parse.
  // Bounded at 5×limit so a source flooded with droppable files cannot force a
  // full-tree parse; hitting the bound short is surfaced as a scan warning
  // (2026-07-19: 323 judge rollouts filled the newest-50 slice and /live
  // showed 0 sessions with 0 warnings).
  const maxScan = Math.min(files.length, limit * 5);
  let scanned = 0;
  let parsedFileCount = 0;
  let duplicateFileCount = 0;
  const sessionIndexes = new Map<string, number>();
  for (const f of files) {
    if (sessions.length >= limit || scanned >= maxScan) break;
    scanned++;
    // The walk already stat'd every file; reuse it for the cache key instead
    // of a second statSync per file inside summarizeWithCache.
    const stat = { mtimeMs: f.mtime, size: f.size };
    const forceReparse = reparseFiles?.has(f.file) ?? false;
    const s = source.format === "codex-sessions"
      ? summarizeCodexSessionFile(f.file, f.project, f.mtime, stat, forceReparse)
      : source.format === "hermes-json"
        ? summarizeHermesSessionFile(f.file, f.project, f.mtime, stat, forceReparse)
        : summarizeLiveSessionFile(f.file, f.project, f.mtime, { fields: source.fields, inferredModel: source.inferredModel, decodeProject: source.format !== "jsonl-dir", sourceFormat: source.format, stat, forceReparse });
    if (s) {
      // Codex/ChatGPT rotates older rollouts into a dedicated on-disk archive.
      // Those files are still live-readable, but must retain archive provenance
      // so Collection totals and the UI do not confuse them with active-root
      // transcripts. Pruned files are marked below by appendArchivedSessions.
      const archivedOnDisk = source.format === "codex-sessions" && isUnderNamedRoot(f.file, source.roots, "archived_sessions");
      const candidate = archivedOnDisk ? { ...s, archived: true } : s;
      parsedFileCount++;
      const existingIndex = sessionIndexes.get(candidate.sessionId);
      if (existingIndex != null) {
        duplicateFileCount++;
        const existing = sessions[existingIndex];
        // Prefer a current on-disk copy over an archived-root copy when both
        // carry the same session id. Otherwise the deterministic mtime/path
        // order above already selected the winner.
        if (existing?.archived && !candidate.archived) sessions[existingIndex] = candidate;
        continue;
      }
      sessionIndexes.set(candidate.sessionId, sessions.length);
      sessions.push(candidate);
    }
  }
  const parseFailureCount = scanned - parsedFileCount;
  if (sessions.length < limit && scanned >= maxScan && files.length > scanned) {
    addScanWarning(scanWarnings, `Only ${sessions.length} of the newest ${scanned} files parsed as sessions (${parseFailureCount} dropped, e.g. judge rollouts or stubs); ${files.length - scanned} older files were not scanned — the view may be missing older sessions`);
  } else if (parseFailureCount > 0 && files.length === scanned) {
    addScanWarning(scanWarnings, `${parseFailureCount} discovered file(s) have unknown or unsupported content and were not parsed; parsed coverage is partial`);
  }
  if (duplicateFileCount > 0) {
    addScanWarning(scanWarnings, `${DUPLICATE_WARNING_PREFIX}: ${duplicateFileCount} file(s) shared an existing session id and were excluded from totals`);
  }
  const partialWarnings = scanWarnings.filter((warning) => !warning.startsWith(DUPLICATE_WARNING_PREFIX));
  const parsedFiles = sessions.length;
  const beforeArchive = sessions.length;
  if (includeArchived) appendArchivedSessions(source, sessions, new Set(files.map((f) => f.file)));
  const coverage: LiveScanCoverage = {
    requestedLimit: limit,
    discoveredFiles: files.length,
    scannedFiles: scanned,
    parsedFiles,
    droppedFiles: parseFailureCount + duplicateFileCount,
    unscannedFiles: files.length - scanned,
    archivedSessionsAdded: sessions.length - beforeArchive,
    truncated: files.length > scanned,
    partial: partialWarnings.length > 0 || files.length > scanned,
  };
  // Inferred costs are derived data, not transcript evidence. Recompute them
  // from current list rates on every scan so persistent/archive cache rows do
  // not freeze stale pricing forever.
  return { sessions: sessions.map(refreshInferredSessionCost), coverage };
}

function refreshInferredSessionCost(session: LiveSession): LiveSession {
  if (session.metricSources.cost === "measured" || session.metricSources.cost === "malformed") return session;
  const rows = attributedModelUsage(session);
  const estimate = session.modelUsage?.length
    ? estimateModelUsageCost(rows)
    : estimateCostUsd(session.model, {
        input: session.inputTokens,
        output: session.outputTokens,
        cacheRead: session.cacheReadTokens,
        cacheCreate: session.cacheCreateTokens,
      });
  if (estimate == null) {
    if (session.costUsd === 0 && session.metricSources.cost === "missing") return session;
    return { ...session, costUsd: 0, metricSources: { ...session.metricSources, cost: "missing" } };
  }
  if (session.costUsd === estimate && session.metricSources.cost === "inferred") return session;
  return { ...session, costUsd: estimate, metricSources: { ...session.metricSources, cost: "inferred" } };
}

function isUnderNamedRoot(file: string, roots: string[], name: string): boolean {
  const resolvedFile = path.resolve(file);
  return roots.some((root) => {
    if (path.basename(path.resolve(root)) !== name) return false;
    const resolvedRoot = path.resolve(root);
    const rel = path.relative(resolvedRoot, resolvedFile);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  });
}

/**
 * Merge in ARCHIVED sessions: cached parses whose files were since pruned from
 * disk (Claude Code keeps ~30 days of transcripts; history should not follow
 * them into the void). Dedupes on sessionId so a rotated/moved file doesn't
 * count twice; the on-disk copy always wins.
 */
function appendArchivedSessions(source: LiveTraceSource, sessions: LiveSession[], scannedFiles?: Set<string>): void {
  const seenIds = new Set(sessions.map((s) => s.sessionId));
  // Two-step read: list file paths only (skips the session_json overflow
  // pages), drop the ~97% that still exist on disk, then hydrate + JSON.parse
  // just the pruned survivors. Files the walk just stat'd trivially exist.
  const scannedIdentities = new Set(Array.from(scannedFiles ?? []).map(sourceFileIdentity));
  const pruned: string[] = [];
  for (const file of listCachedFilesUnder(source.roots)) {
    if (scannedIdentities.has(sourceFileIdentity(file))) continue;
    let onDisk = false;
    try { onDisk = fs.existsSync(file); } catch {}
    if (!onDisk) pruned.push(file);
  }
  for (const { session, parserVersion } of getCachedSessionRows(pruned.sort((a, b) => a.localeCompare(b)))) {
    if (seenIds.has(session.sessionId)) continue;
    seenIds.add(session.sessionId);
    // Rows for pruned files intentionally survive parser-version bumps, so an
    // archived session can still carry the old false-positive warning that
    // interactive transcripts were truncated solely because no result event
    // was present. Normalize that exact stale label on the archive path;
    // malformed/runtime/actionable warnings remain untouched.
    const parseWarnings = (Array.isArray(session.parseWarnings) ? session.parseWarnings : [])
      .filter((warning) => warning !== "no final result event found");
    const staleParserWarning = parserVersion < PARSER_VERSION
      ? `archived parse v${parserVersion}; source was pruned before current parser v${PARSER_VERSION} could re-read it`
      : null;
    sessions.push({
      ...session,
      archived: true,
      staleMs: Math.max(0, Date.now() - session.lastEventAt),
      parseWarnings: staleParserWarning && !parseWarnings.includes(staleParserWarning)
        ? [...parseWarnings, staleParserWarning]
        : parseWarnings,
    });
  }
  sessions.sort((a, b) => b.lastEventAt - a.lastEventAt || a.sessionId.localeCompare(b.sessionId) || (a.path ?? "").localeCompare(b.path ?? ""));
}

/**
 * Full parsed session list for a source, UNCAPPED (the aggregate's `sessions`
 * array is retention-capped for display; longitudinal analytics need them all).
 * Pass `preCollected` (e.g. discovery's walk) to skip re-walking the tree.
 */
export function collectSourceSessions(spec: CollectionSourceSpec, limit = 100_000, opts: { includeArchived?: boolean; preCollected?: CollectedSourceFiles; reparseFiles?: ReadonlySet<string> } = {}): LiveSession[] {
  return parseSourceSessionList(specToSource(spec), limit, [], opts.includeArchived ?? false, opts.preCollected, opts.reparseFiles).sessions;
}

function scanResolvedSource(source: LiveTraceSource, limit: number, includeArchived = false, preCollected?: CollectedSourceFiles, sessionRetention?: number, reparseFiles?: ReadonlySet<string>): LiveAggregate {
  const scanWarnings: string[] = [];
  if (source.status !== "available" && source.message) scanWarnings.push(source.message);
  const { sessions, coverage } = parseSourceSessionList(source, limit, scanWarnings, includeArchived, preCollected, reparseFiles);
  return aggregate(sessions, scanWarnings, source, sessionRetention, coverage);
}

function collectLiveTraceFiles(source: LiveTraceSource, scanWarnings: string[]): SourceFile[] {
  const files: SourceFile[] = [];
  // One visited-realpath set for the whole source walk, shared across roots and
  // recursion. Guards against filesystem cycles (bind mounts / hardlinked dirs
  // where isDirectory() is true and the real path repeats within maxDepth) and
  // overlapping roots (a root that is a symlink to, or a subdirectory of,
  // another root) both walking the same physical directory twice.
  const visited = new Set<string>();
  const depthProbeBudget = { remaining: DEPTH_PROBE_ENTRY_CAP };
  for (const root of source.roots) {
    if (source.format === "claude-projects") {
      let projectDirs: string[] = [];
      try {
        projectDirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort((a, b) => a.localeCompare(b));
      } catch (e) {
        addScanWarning(scanWarnings, `Could not read ${root}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      for (const pd of projectDirs) {
        const pdir = path.join(root, pd);
        let entries: fs.Dirent[] = [];
        try {
          entries = fs.readdirSync(pdir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
        } catch (e) {
          if ((e as { code?: string })?.code !== "ENOENT") addScanWarning(scanWarnings, `Could not read ${pdir}: ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
        for (const ent of entries) {
          if (ent.isFile() && ent.name.endsWith(".jsonl")) {
            const full = path.join(pdir, ent.name);
            try {
              const st = fs.statSync(full);
              files.push({ file: full, project: pd, mtime: st.mtimeMs, size: st.size });
            } catch {}
            continue;
          }
          if (!ent.isDirectory()) continue;
          // Claude stores child-agent transcripts one level below each parent:
          // <project>/<parent-session>/subagents/agent-*.jsonl, while workflow
          // children add workflows/<workflow>/agent-*.jsonl. This bounded,
          // format-specific lookup captures both without walking worktrees,
          // tool artifacts, or metadata files.
          const subagentsDir = path.join(pdir, ent.name, "subagents");
          collectClaudeSubagentFiles(subagentsDir, 2, files, pd, visited, scanWarnings, depthProbeBudget);
        }
      }
    } else if (source.format === "agent-sqlite") {
      collectJsonlRecursive(root, 3, files, root, name => name === "opencode.db" || name === "db.sqlite", visited, scanWarnings, depthProbeBudget);
    } else if (source.format === "kimi-wire") {
      collectJsonlRecursive(root, 6, files, root, name => name === "wire.jsonl", visited, scanWarnings, depthProbeBudget);
    } else if (source.format === "deepseek-jsonl") {
      collectJsonlRecursive(root, 4, files, root, name => name === "session.v3.jsonl", visited, scanWarnings, depthProbeBudget);
    } else if (source.format === "grok-markdown") {
      collectJsonlRecursive(root, 3, files, root, name => name.endsWith(".md"), visited, scanWarnings, depthProbeBudget);
    } else if (source.format === "hermes-json") {
      // Hermes sessions are single-JSON files; skip its request_dump_* payload logs.
      collectJsonlRecursive(root, source.maxDepth, files, root, (name) => name.startsWith("session_") && name.endsWith(".json"), visited, scanWarnings, depthProbeBudget);
    } else if (source.format === "hermes-sqlite") {
      // The session ledger DBs: the default ~/.hermes/state.db plus one
      // ~/.hermes/profiles/<name>/state.db per named profile. Depth 3 covers
      // root → profiles → <name> → state.db without walking unrelated trees
      // (sandboxes, chrome-debug, browser-profile …) that cannot match.
      collectJsonlRecursive(root, 3, files, root, (name) => name === "state.db", visited, scanWarnings, depthProbeBudget);
    } else {
      collectJsonlRecursive(root, source.maxDepth, files, root, undefined, visited, scanWarnings, depthProbeBudget);
    }
  }
  // A source may declare overlapping roots (or a symlinked root). Directory
  // visitation prevents most duplication, but Claude's direct project files
  // do not recurse through that guard. Canonicalize the final inventory so a
  // physical transcript contributes exactly once to coverage and totals.
  const unique = new Map<string, SourceFile>();
  for (const entry of files) {
    const key = sourceFileIdentity(entry.file);
    const previous = unique.get(key);
    if (!previous || compareSourceFiles(entry, previous) < 0) unique.set(key, entry);
  }
  if (files.length > unique.size) addScanWarning(scanWarnings, `${DUPLICATE_WARNING_PREFIX}: ${files.length - unique.size} filesystem entry/entries resolved to an existing transcript`);
  return [...unique.values()].sort(compareSourceFiles);
}

const MAX_SCAN_WARNINGS = 32;

function addScanWarning(scanWarnings: string[], warning: string): void {
  if (!warning || scanWarnings.includes(warning) || scanWarnings.length >= MAX_SCAN_WARNINGS) return;
  scanWarnings.push(warning);
}

function collectClaudeSubagentFiles(
  dir: string,
  depth: number,
  files: SourceFile[],
  project: string,
  visited: Set<string>,
  scanWarnings: string[],
  depthProbeBudget: { remaining: number },
): void {
  if (depth < 0) return;
  let real: string;
  try {
    real = fs.realpathSync(dir);
  } catch {
    real = path.resolve(dir);
  }
  if (visited.has(real)) return;
  visited.add(real);
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    if ((e as { code?: string })?.code !== "ENOENT") addScanWarning(scanWarnings, `Could not read live trace directory ${dir}: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth === 0) {
        addDepthBoundaryWarning(scanWarnings, full, probeForMatchingFileBelow(full, (name) => /^agent-.+\.jsonl$/i.test(name), depthProbeBudget));
        continue;
      }
      collectClaudeSubagentFiles(full, depth - 1, files, project, visited, scanWarnings, depthProbeBudget);
      continue;
    }
    if (!entry.isFile() || !/^agent-.+\.jsonl$/i.test(entry.name)) continue;
    try {
      const stat = fs.statSync(full);
      files.push({ file: full, project, mtime: stat.mtimeMs, size: stat.size });
    } catch (e) {
      if ((e as { code?: string })?.code !== "ENOENT") addScanWarning(scanWarnings, `Could not stat live trace ${full}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

function collectJsonlRecursive(
  dir: string,
  depth: number,
  files: SourceFile[],
  root: string,
  matches: (name: string) => boolean = (name) => name.endsWith(".jsonl"),
  visited: Set<string> = new Set<string>(),
  scanWarnings: string[] = [],
  depthProbeBudget: { remaining: number } = { remaining: DEPTH_PROBE_ENTRY_CAP },
): void {
  if (depth < 0) return;
  // Canonicalize before descending so each physical directory is walked once,
  // even if reached via a filesystem cycle or an overlapping/symlinked root.
  // realpathSync resolves symlinks (a symlinked ROOT is followed here, unlike
  // symlinked child entries, which readdir reports as non-directories); fall
  // back to the resolved lexical path if it can't be canonicalized so a
  // still-listable dir is not silently skipped.
  let real: string;
  try {
    real = fs.realpathSync(dir);
  } catch {
    real = path.resolve(dir);
  }
  if (visited.has(real)) return;
  visited.add(real);
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    if ((e as { code?: string })?.code !== "ENOENT") addScanWarning(scanWarnings, `Could not read live trace directory ${dir}: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (depth === 0) {
        addDepthBoundaryWarning(scanWarnings, full, probeForMatchingFileBelow(full, matches, depthProbeBudget));
        continue;
      }
      collectJsonlRecursive(full, depth - 1, files, root, matches, visited, scanWarnings, depthProbeBudget);
      continue;
    }
    if (!ent.isFile() || !matches(ent.name)) continue;
    try {
      const st = fs.statSync(full);
      files.push({ file: full, project: path.dirname(path.relative(root, full)) || path.basename(root), mtime: st.mtimeMs, size: st.size });
    } catch (e) {
      if ((e as { code?: string })?.code !== "ENOENT") addScanWarning(scanWarnings, `Could not stat live trace ${full}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
