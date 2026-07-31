import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { isPathInAnyCollectionSource } from "@/lib/collection/sources";
import { parseSessionTranscript } from "@/lib/live";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_PAGE_SIZE = 240;

type TurnCounts = {
  all: number;
  chat: number;
  tools: number;
  errors: number;
};

function countTurns(turns: ReturnType<typeof parseSessionTranscript>["turns"]): TurnCounts {
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

/**
 * Bounded transcript window for the client viewer. Raw files stay on disk and
 * are parsed only on demand; the response is limited to the requested page
 * and no transcript body is copied into the parsed session cache or a
 * long-lived API response.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const file = url.searchParams.get("file") ?? "";
  if (!file || !path.isAbsolute(file)) return badRequest("A session file path is required.");
  if (!isPathInAnyCollectionSource(file)) return badRequest("That path is not inside a known collection source.", 403);
  let safeFile: string;
  let stat: fs.Stats;
  try {
    // Resolve the path once more after the source check. This keeps a symlink
    // that points outside a declared source from reaching the parser, even if
    // the source check accepted only its lexical location.
    safeFile = fs.realpathSync(file);
    if (!isPathInAnyCollectionSource(safeFile)) return badRequest("That path is not inside a known collection source.", 403);
    stat = fs.statSync(safeFile);
    if (!stat.isFile()) return badRequest("The session file is unavailable.", 404);
  } catch {
    return badRequest("The session file is unavailable.", 404);
  }

  const rawOffset = Number(url.searchParams.get("offset") ?? 0);
  const rawLimit = Number(url.searchParams.get("limit") ?? MAX_PAGE_SIZE);
  if (!Number.isInteger(rawOffset) || rawOffset < 0 || !Number.isInteger(rawLimit) || rawLimit < 1) {
    return badRequest("offset must be a non-negative integer and limit must be a positive integer.");
  }
  const offset = rawOffset;
  const limit = Math.min(rawLimit, MAX_PAGE_SIZE);
  const parsed = parseSessionTranscript(safeFile);
  if (parsed.error) {
    return NextResponse.json({
      error: parsed.error,
      turns: [],
      total: 0,
      counts: countTurns([]),
      truncated: parsed.truncated === true,
      normalization: parsed.normalization,
    }, { status: 422, headers: { "Cache-Control": "private, no-store" } });
  }
  const counts = countTurns(parsed.turns);
  const revision = `${stat.size}:${stat.mtimeMs}`;
  return NextResponse.json({
    turns: parsed.turns.slice(offset, offset + limit),
    offset,
    total: counts.all,
    counts,
    truncated: parsed.truncated === true,
    normalization: parsed.normalization,
    revision,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
