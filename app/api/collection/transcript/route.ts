import fs from "node:fs";
import { NextResponse } from "next/server";
import { readTranscriptWindow, type LiveTranscriptTurn } from "@/lib/live";
import { PARSER_VERSION } from "@/lib/live-cache";
import { resolveCollectionSession, resolveLegacyCollectionFile, type ResolvedCollectionSession } from "@/lib/collection/resolver";
import { decodeTranscriptCursor, encodeTranscriptCursor, transcriptDescriptorHash, type TranscriptCursorPayload } from "@/lib/collection/transcript-cursor";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type TurnCounts = { all: number; chat: number; tools: number; errors: number };

function countTurns(turns: LiveTranscriptTurn[]): TurnCounts {
  return {
    all: turns.length,
    chat: turns.filter((turn) => turn.role === "user" || turn.role === "assistant").length,
    tools: turns.filter((turn) => turn.role === "tool" || turn.severity === "error").length,
    errors: turns.filter((turn) => turn.severity === "error").length,
  };
}

function badRequest(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message, turns: [], total: 0 }, { status, headers: { "Cache-Control": "private, no-store" } });
}

function stale(message: string): NextResponse {
  return NextResponse.json({ error: message, staleCursor: true, refreshRequired: true, turns: [] }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
}

function sessionReference(url: URL): { sourceId: string; sessionId: string; pathHint?: string } | null {
  const sourceId = url.searchParams.get("sourceId") ?? "";
  const sessionId = url.searchParams.get("sessionId") ?? "";
  if (!sourceId || !sessionId) return null;
  const pathHint = url.searchParams.get("pathHint") ?? undefined;
  return { sourceId, sessionId, ...(pathHint ? { pathHint } : {}) };
}

function responseForWindow(
  resolved: ResolvedCollectionSession,
  window: ReturnType<typeof readTranscriptWindow>,
  cursor: TranscriptCursorPayload | null,
): NextResponse {
  const nextCursor = window.done || !window.nextState
    ? null
    : encodeTranscriptCursor({
        v: 1,
        sourceId: resolved.sourceId,
        sessionId: resolved.sessionId,
        file: resolved.file,
        project: resolved.project,
        format: resolved.spec.format,
        parserVersion: PARSER_VERSION,
        descriptorHash: transcriptDescriptorHash(resolved.sourceId, resolved.spec),
        revision: window.revision,
        byteOffset: window.nextByteOffset,
        state: window.nextState,
      });
  const body = {
    turns: window.turns,
    offset: window.offset,
    counts: countTurns(window.turns),
    normalization: window.normalization,
    revision: window.revision,
    nextCursor,
    hasMore: nextCursor != null,
    // Exact totals are intentionally omitted until a bounded cursor reaches
    // EOF. A first page must not scan the complete source just to count it.
    ...(window.done ? { total: window.offset + window.turns.length } : {}),
    ...(cursor ? {} : { sourceId: resolved.sourceId, sessionId: resolved.sessionId }),
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
}

/**
 * Revision-bound transcript window. New callers identify a source/session;
 * absolute `file=` links are accepted only through the current inventory as a
 * compatibility path and remain deliberately separate from cursor paging.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawCursor = url.searchParams.get("cursor");
  const cursor = rawCursor ? decodeTranscriptCursor(rawCursor) : null;
  if (rawCursor && !cursor) return stale("This transcript cursor is invalid or was created by an older parser; refresh the transcript.");

  if (!cursor && !sessionReference(url)) {
    const legacyFile = url.searchParams.get("file") ?? "";
    if (!legacyFile) return badRequest("A source-qualified session reference is required.");
    const legacy = resolveLegacyCollectionFile(legacyFile);
    if (!legacy || !("file" in legacy)) return badRequest("That transcript is not present in the current source inventory.", 404);
    // Compatibility links are converted only after exact current-inventory
    // equality. The canonical route owns bounded windows and cursor state;
    // never reintroduce the old path+offset full-file hydration here.
    const canonical = new URL(request.url);
    canonical.search = "";
    canonical.searchParams.set("sourceId", legacy.sourceId);
    canonical.searchParams.set("sessionId", legacy.sessionId);
    return NextResponse.redirect(canonical, { status: 307, headers: { "Cache-Control": "private, no-store" } });
  }

  const reference = cursor
    ? { sourceId: cursor.sourceId, sessionId: cursor.sessionId, pathHint: cursor.file, trustedPathHint: true }
    : sessionReference(url)!;
  const resolved = resolveCollectionSession(reference);
  if (!resolved) return badRequest("That source-qualified session is not present in the current source inventory.", 404);
  if (!("file" in resolved)) return NextResponse.json({ error: "The transcript was pruned; only its archived summary remains.", rawUnavailable: true, archived: true, turns: [] }, { status: 410, headers: { "Cache-Control": "private, no-store" } });

  const current = (() => {
    try {
      const stat = fs.statSync(resolved.file);
      return { size: stat.size, mtimeMs: stat.mtimeMs };
    } catch { return null; }
  })();
  if (!current) return stale("The transcript disappeared while it was open; refresh to load the archived/raw state.");
  if (cursor) {
    if (cursor.sourceId !== resolved.sourceId || cursor.sessionId !== resolved.sessionId || cursor.format !== resolved.spec.format || cursor.project !== resolved.project || cursor.descriptorHash !== transcriptDescriptorHash(resolved.sourceId, resolved.spec) || cursor.revision.size !== current.size || cursor.revision.mtimeMs !== current.mtimeMs) {
      return stale("The transcript changed; refresh before loading another window.");
    }
  }

  try {
    const window = readTranscriptWindow(resolved.file, resolved.spec.format, {
      // Cursor continuations resume an earlier bounded window; DB-backed
      // formats always need the session id that scopes the expansion.
      ...(cursor ? { byteOffset: cursor.byteOffset, state: cursor.state } : {}),
      ...(resolved.spec.format === "hermes-sqlite" ? { sessionId: resolved.sessionId } : {}),
    });
    if (cursor && (window.revision.fingerprint !== cursor.revision.fingerprint || window.revision.size !== cursor.revision.size || window.revision.mtimeMs !== cursor.revision.mtimeMs)) return stale("The transcript changed; refresh before loading another window.");
    return responseForWindow(resolved, window, cursor);
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Transcript window could not be loaded.", 422);
  }
}
