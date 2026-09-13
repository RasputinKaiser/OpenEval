import { parseAgentDbSessions } from "../live/parse-agent-db";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectSourceFiles, collectSourceSessions, parseHermesDbSessions, type CollectionSourceSpec, type LiveSession } from "../live";
import { summarizeCodexSessionFile, summarizeHermesSessionFile, summarizeLiveSessionFile } from "../live/summarize";
import { allCollectionSources, defToSpec, type CollectionSourceDef } from "./sources";

export interface CollectionSessionReference {
  sourceId: string;
  sessionId: string;
  /** A server-issued or legacy equality hint; never used as filesystem authority. */
  pathHint?: string;
  /** Only cursors minted by this server may use the no-reparse fast path. */
  trustedPathHint?: boolean;
}

export interface ResolvedCollectionSession {
  sourceId: string;
  source: CollectionSourceDef;
  spec: CollectionSourceSpec;
  sessionId: string;
  file: string;
  project: string;
  mtimeMs: number;
  size: number;
  session: LiveSession | null;
  revision: string;
}

export interface ArchivedCollectionSession {
  sourceId: string;
  source: CollectionSourceDef;
  sessionId: string;
  archived: true;
  session: LiveSession | null;
}

export type CollectionResolution = ResolvedCollectionSession | ArchivedCollectionSession | null;

function sourceForId(sourceId: string): CollectionSourceDef | null {
  const source = allCollectionSources().find((candidate) => candidate.id === sourceId);
  return source?.parseable ? source : null;
}

function expandedRoots(source: CollectionSourceDef): string[] {
  return source.roots.map((root) => root === "~" ? os.homedir() : root.startsWith("~/") ? path.join(os.homedir(), root.slice(2)) : root);
}

function isInsideRealRoot(file: string, roots: string[]): boolean {
  const realFile = (() => { try { return fs.realpathSync(file); } catch { return null; } })();
  if (!realFile) return false;
  return roots.some((root) => {
    let realRoot: string;
    try { realRoot = fs.realpathSync(root); } catch { return false; }
    const relative = path.relative(realRoot, realFile);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  });
}

function isArchivedPathForSource(file: string, source: CollectionSourceDef): boolean {
  if (typeof file !== "string" || !path.isAbsolute(file)) return false;
  const extension = path.extname(file).toLowerCase();
  if (source.format === "hermes-json") {
    if (extension !== ".json" || !path.basename(file).startsWith("session_")) return false;
  } else if (extension !== ".jsonl") {
    return false;
  }
  const absolute = path.resolve(file);
  return expandedRoots(source).some((root) => {
    const relative = path.relative(path.resolve(root), absolute);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  });
}

function revisionFor(stat: { size: number; mtimeMs: number }): string {
  return `${stat.size}:${stat.mtimeMs}`;
}

/**
 * Resolve a source-qualified session through the current server-owned file
 * inventory. `pathHint` is compared to discovered entries only; parser and
 * filesystem code receive the discovered path, never the request value.
 */
export function resolveCollectionSession(reference: CollectionSessionReference): CollectionResolution {
  if (!reference || typeof reference.sourceId !== "string" || typeof reference.sessionId !== "string") return null;
  if (!reference.sourceId || !reference.sessionId || reference.sourceId.length > 160 || reference.sessionId.length > 512) return null;
  const source = sourceForId(reference.sourceId);
  if (!source) return null;
  const spec = defToSpec(source);
  const collected = collectSourceFiles(spec);
  const requestedHint = reference.pathHint ? path.resolve(reference.pathHint) : null;
  const candidates = collected.files.filter((entry) => {
    if (!isInsideRealRoot(entry.file, expandedRoots(source))) return false;
    return requestedHint == null || path.resolve(entry.file) === requestedHint;
  });

  // The path hint fast path is used by Collection links and cursor continuations.
  // Without it, parse the source inventory until the source-local session id is
  // found. This supports direct source/session links without trusting a path.
  for (const entry of candidates) {
    const stat = { size: entry.size, mtimeMs: entry.mtime };
    if (requestedHint != null && reference.trustedPathHint) {
      return {
        sourceId: source.id,
        source,
        spec,
        sessionId: reference.sessionId,
        file: entry.file,
        project: entry.project,
        mtimeMs: entry.mtime,
        size: entry.size,
        session: null,
        revision: revisionFor(stat),
      };
    }
    const session = parseCandidate(entry.file, entry.project, entry.mtime, stat, spec, reference.sessionId);
    if (session?.sessionId !== reference.sessionId) continue;
    return {
      sourceId: source.id,
      source,
      spec,
      sessionId: reference.sessionId,
      file: entry.file,
      project: entry.project,
      mtimeMs: entry.mtime,
      size: entry.size,
      session,
      revision: revisionFor(stat),
    };
  }

  // A browser-supplied path hint must match a currently discovered file. A
  // server-issued cursor is different: its raw file may have been pruned
  // since the first window, in which case the source-qualified session should
  // still resolve to the durable archived summary instead of becoming an
  // arbitrary-path 404.
  if (requestedHint != null && !reference.trustedPathHint) return null;
  // Include archived summaries in the resolution result, but never return an
  // archived path as readable raw evidence.
  const archived = collectSourceSessions(spec, 100_000, { includeArchived: true, preCollected: collected })
    .find((session) => session.sessionId === reference.sessionId && session.archived && isArchivedPathForSource(session.path ?? "", source));
  return archived ? { sourceId: source.id, source, sessionId: reference.sessionId, archived: true, session: archived } : null;
}

function parseCandidate(
  file: string,
  project: string,
  mtime: number,
  stat: { size: number; mtimeMs: number },
  spec: CollectionSourceSpec,
  sessionId?: string,
): LiveSession | null {
  const sourceFormat = spec.format;
  if (sourceFormat === "agent-sqlite") return parseAgentDbSessions(file).find(session => session.sessionId === sessionId) ?? null;
  return sourceFormat === "codex-sessions"
    ? summarizeCodexSessionFile(file, project, mtime, stat)
    : sourceFormat === "hermes-json"
      ? summarizeHermesSessionFile(file, project, mtime, stat)
      : sourceFormat === "hermes-sqlite"
        // A DB candidate expands to many sessions; the expansion is memoized
        // per (file, stat) in parse-hermes-db, so scanning candidates for one
        // session id re-parses nothing.
        ? sessionId
          ? parseHermesDbSessions(file, mtime, stat).find((session) => session.sessionId === sessionId) ?? null
          : null
        : summarizeLiveSessionFile(file, project, mtime, {
            fields: spec.fields,
            inferredModel: spec.inferredModel,
            decodeProject: sourceFormat !== "jsonl-dir",
            sourceFormat,
            stat,
          });
}

/** Resolve a legacy absolute-file link only after current inventory equality. */
export function resolveLegacyCollectionFile(filePath: string): ResolvedCollectionSession | ArchivedCollectionSession | null {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath) || filePath.length > 4096) return null;
  const requested = path.resolve(filePath);
  for (const source of allCollectionSources().filter((candidate) => candidate.parseable)) {
    const resolved = resolveCollectionSessionByPath(source, requested);
    if (resolved) return resolved;
  }
  return null;
}

function resolveCollectionSessionByPath(source: CollectionSourceDef, requested: string): CollectionResolution {
  const spec = defToSpec(source);
  const collected = collectSourceFiles(spec);
  const entry = collected.files.find((candidate) => path.resolve(candidate.file) === requested);
  if (!entry || !isInsideRealRoot(entry.file, expandedRoots(source))) return null;
  const stat = { size: entry.size, mtimeMs: entry.mtime };
  const session = parseCandidate(entry.file, entry.project, entry.mtime, stat, spec, path.basename(requested, path.extname(requested)));
  return {
    sourceId: source.id,
    source,
    spec,
    // Legacy transcript fixtures and a few detectably valid traces do not
    // carry a session id in their summary envelope. They still pass the
    // inventory equality gate and can be opened as raw evidence.
    sessionId: session?.sessionId ?? path.basename(entry.file),
    file: entry.file,
    project: entry.project,
    mtimeMs: entry.mtime,
    size: entry.size,
    session,
    revision: revisionFor(stat),
  };
}
