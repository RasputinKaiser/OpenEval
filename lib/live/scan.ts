import fs from "node:fs";
import path from "node:path";
import { getCachedSessionRows, listCachedFilesUnder, PARSER_VERSION } from "../live-cache";
import { estimateCostUsd } from "../pricing";
import type { CollectedSourceFiles, CollectionSourceSpec, LiveAggregate, LiveSession, LiveTraceSource } from "./types";
import { resolveLiveSource, specToSource } from "./sources";
import { summarizeCodexSessionFile, summarizeHermesSessionFile, summarizeLiveSessionFile } from "./summarize";
import { aggregate } from "./aggregate";
import { attributedModelUsage, estimateModelUsageCost } from "./util";

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

function parseSourceSessionList(source: LiveTraceSource, limit: number, scanWarnings: string[], includeArchived = false, preCollected?: CollectedSourceFiles, reparseFiles?: ReadonlySet<string>): LiveSession[] {
  const sessions: LiveSession[] = [];
  if (source.status !== "available") return sessions;
  let files: Array<{ file: string; project: string; mtime: number; size: number }>;
  if (preCollected) {
    // Copy before sorting — the caller may share the collected list.
    files = [...preCollected.files];
    scanWarnings.push(...preCollected.scanWarnings);
  } else {
    files = collectLiveTraceFiles(source, scanWarnings);
  }
  files.sort((a, b) => b.mtime - a.mtime);
  for (const f of files.slice(0, limit)) {
    // The walk already stat'd every file; reuse it for the cache key instead
    // of a second statSync per file inside summarizeWithCache.
    const stat = { mtimeMs: f.mtime, size: f.size };
    const forceReparse = reparseFiles?.has(f.file) ?? false;
    const s = source.format === "codex-sessions"
      ? summarizeCodexSessionFile(f.file, f.project, f.mtime, stat, forceReparse)
      : source.format === "hermes-json"
        ? summarizeHermesSessionFile(f.file, f.project, f.mtime, stat, forceReparse)
        : summarizeLiveSessionFile(f.file, f.project, f.mtime, { fields: source.fields, inferredModel: source.inferredModel, decodeProject: source.format !== "jsonl-dir", stat, forceReparse });
    if (s) {
      // Codex/ChatGPT rotates older rollouts into a dedicated on-disk archive.
      // Those files are still live-readable, but must retain archive provenance
      // so Collection totals and the UI do not confuse them with active-root
      // transcripts. Pruned files are marked below by appendArchivedSessions.
      const archivedOnDisk = source.format === "codex-sessions" && isUnderNamedRoot(f.file, source.roots, "archived_sessions");
      sessions.push(archivedOnDisk ? { ...s, archived: true } : s);
    }
  }
  if (includeArchived) appendArchivedSessions(source, sessions, new Set(files.map((f) => f.file)));
  // Inferred costs are derived data, not transcript evidence. Recompute them
  // from current list rates on every scan so persistent/archive cache rows do
  // not freeze stale pricing forever.
  return sessions.map(refreshInferredSessionCost);
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
  const pruned: string[] = [];
  for (const file of listCachedFilesUnder(source.roots)) {
    if (scannedFiles?.has(file)) continue;
    let onDisk = false;
    try { onDisk = fs.existsSync(file); } catch {}
    if (!onDisk) pruned.push(file);
  }
  for (const { session, parserVersion } of getCachedSessionRows(pruned)) {
    if (seenIds.has(session.sessionId)) continue;
    seenIds.add(session.sessionId);
    const parseWarnings = Array.isArray(session.parseWarnings) ? session.parseWarnings : [];
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
  sessions.sort((a, b) => b.lastEventAt - a.lastEventAt);
}

/**
 * Full parsed session list for a source, UNCAPPED (the aggregate's `sessions`
 * array is retention-capped for display; longitudinal analytics need them all).
 * Pass `preCollected` (e.g. discovery's walk) to skip re-walking the tree.
 */
export function collectSourceSessions(spec: CollectionSourceSpec, limit = 100_000, opts: { includeArchived?: boolean; preCollected?: CollectedSourceFiles; reparseFiles?: ReadonlySet<string> } = {}): LiveSession[] {
  return parseSourceSessionList(specToSource(spec), limit, [], opts.includeArchived ?? false, opts.preCollected, opts.reparseFiles);
}

function scanResolvedSource(source: LiveTraceSource, limit: number, includeArchived = false, preCollected?: CollectedSourceFiles, sessionRetention?: number, reparseFiles?: ReadonlySet<string>): LiveAggregate {
  const scanWarnings: string[] = [];
  if (source.status !== "available" && source.message) scanWarnings.push(source.message);
  const sessions = parseSourceSessionList(source, limit, scanWarnings, includeArchived, preCollected, reparseFiles);
  return aggregate(sessions, scanWarnings, source, sessionRetention);
}

function collectLiveTraceFiles(source: LiveTraceSource, scanWarnings: string[]): Array<{ file: string; project: string; mtime: number; size: number }> {
  const files: Array<{ file: string; project: string; mtime: number; size: number }> = [];
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
            files.push({ file: full, project: pd, mtime: st.mtimeMs, size: st.size });
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
  files: Array<{ file: string; project: string; mtime: number; size: number }>,
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
      files.push({ file: full, project: path.dirname(path.relative(root, full)) || path.basename(root), mtime: st.mtimeMs, size: st.size });
    } catch {}
  }
}
