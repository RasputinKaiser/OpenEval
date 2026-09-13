import { NextResponse } from "next/server";
import { parseChartSelection } from "@/lib/chart-analysis";
import {
  isUnsupportedCollectionSelection,
} from "@/lib/collection/analysis";
import { getCollectionSnapshot } from "@/lib/collection/snapshot-service";
import { readAnalysisReport } from "@/lib/collection/analysis-cache";
import { apiError } from "@/lib/api-http";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 200;

function positiveInteger(raw: string | null, fallback: number): number | null {
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/** Full-population Collection analysis with redaction-safe evidence rows. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = parseChartSelection(searchParams);
  if (parsed.error) return apiError(400, "Invalid chart selection", { detail: parsed.error, field: "viz" });
  const unsupported = isUnsupportedCollectionSelection(parsed.selection);
  if (unsupported) return apiError(400, "Unsupported Collection analysis filter", { detail: unsupported, field: "vizOutcome" });

  const rawLimit = searchParams.get("limit") ?? searchParams.get("page");
  const rawOffset = searchParams.get("offset");
  const limitValue = positiveInteger(rawLimit, DEFAULT_LIMIT);
  const offset = positiveInteger(rawOffset, 0);
  if (limitValue === null || limitValue === 0 || offset === null) {
    return apiError(400, "Invalid analysis page", { detail: "limit/page must be an integer from 1 to 200 and offset must be a non-negative integer." });
  }
  const limit = Math.min(MAX_LIMIT, limitValue);

  const rawGeneration = searchParams.get("generation");
  let requestedGeneration: number | undefined;
  if (rawGeneration !== null) {
    const value = Number(rawGeneration);
    if (!Number.isFinite(value)) return apiError(400, "Invalid snapshot generation", { field: "generation" });
    requestedGeneration = value;
  }

  try {
    const snapshot = await getCollectionSnapshot({ forceRefresh: searchParams.get("fresh") === "1" });
    if (requestedGeneration !== undefined && requestedGeneration !== snapshot.generatedAtMs) {
      return NextResponse.json(
        { error: "collection snapshot changed; restart analysis pagination", generatedAtMs: snapshot.generatedAtMs },
        { status: 409, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const population = snapshot.value.sessions;
    const report = readAnalysisReport(population, parsed.selection, {
      generatedAtMs: snapshot.generatedAtMs,
      stale: snapshot.stale,
      refreshing: snapshot.refreshing,
      partial: snapshot.partial || snapshot.value.aggregate.partial,
      refreshError: snapshot.refreshError,
    }, { offset, limit });
    return NextResponse.json(report, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(500, "Collection analysis unavailable", {
      detail: error instanceof Error ? error.message : String(error),
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}

