import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-http";
import { parseChartSelection } from "@/lib/chart-analysis";
import { filterAnalysisSessions, isUnsupportedCollectionSelection } from "@/lib/collection/analysis";
import { buildEvidenceSessionListPage, EVIDENCE_SESSION_DEFAULT_LIMIT, EVIDENCE_SESSION_MAX_LIMIT, filterEvidenceSessionMetadata } from "@/lib/collection/evidence-session-list";
import { getCollectionSnapshot } from "@/lib/collection/snapshot-service";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

function nonNegativeInteger(raw: string | null, fallback: number): number | null {
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/** Bounded metadata selector for evidence sessions; it never performs text search. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = parseChartSelection(searchParams);
  if (parsed.error) return apiError(400, "Invalid chart selection", { detail: parsed.error, field: "viz", headers });
  const unsupported = isUnsupportedCollectionSelection(parsed.selection);
  if (unsupported) return apiError(400, "Unsupported evidence session filter", { detail: unsupported, field: "vizOutcome", headers });
  const rawLimit = searchParams.get("limit");
  const rawOffset = searchParams.get("offset");
  const limitValue = nonNegativeInteger(rawLimit, EVIDENCE_SESSION_DEFAULT_LIMIT);
  const offset = nonNegativeInteger(rawOffset, 0);
  if (limitValue === null || limitValue === 0 || offset === null) return apiError(400, "Invalid evidence session page", { detail: "limit must be an integer from 1 to 100 and offset must be a non-negative integer.", headers });
  const limit = Math.min(EVIDENCE_SESSION_MAX_LIMIT, limitValue);
  const query = searchParams.get("q")?.trim() ?? "";
  if (query.length > 256 || /[\x00-\x1f]/.test(query)) return apiError(400, "Invalid metadata search", { detail: "Search is limited to title, session ID, and model metadata.", field: "q", headers });
  const rawGeneration = searchParams.get("generation");
  let requestedGeneration: number | undefined;
  if (rawGeneration !== null) {
    const value = Number(rawGeneration);
    if (!Number.isFinite(value)) return apiError(400, "Invalid snapshot generation", { field: "generation", headers });
    requestedGeneration = value;
  }
  try {
    const snapshot = await getCollectionSnapshot();
    if (requestedGeneration !== undefined && requestedGeneration !== snapshot.generatedAtMs) {
      return NextResponse.json({ error: "collection snapshot changed; restart evidence pagination", generatedAtMs: snapshot.generatedAtMs }, { status: 409, headers });
    }
    const selected = filterAnalysisSessions(snapshot.value.sessions, parsed.selection);
    const matched = filterEvidenceSessionMetadata(selected, query);
    const page = buildEvidenceSessionListPage(matched, { generation: snapshot.generatedAtMs, query }, { offset, limit });
    return NextResponse.json(page, { headers });
  } catch (error) {
    return apiError(500, "Evidence session list unavailable", { detail: error instanceof Error ? error.message : String(error), headers });
  }
}
