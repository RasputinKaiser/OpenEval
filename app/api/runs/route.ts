import { NextResponse } from "next/server";
import { createAndStartRun } from "@/lib/run";
import { listRuns } from "@/lib/db";
import { hasAdapter, listAdapters } from "@/lib/adapters/registry";
import type { RunnerKind } from "@/lib/types";
import { badRequest, internalError } from "@/lib/api-http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const runs = listRuns(10);
    const lite = runs.map((r) => ({ id: r.id, name: r.name, status: r.status }));
    return NextResponse.json(
      { runs: lite },
      { headers: { "Cache-Control": "private, max-age=10, stale-while-revalidate=30" } }
    );
  } catch (error) {
    return internalError("Failed to list runs", error);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const runner = body.runner === "tmux" ? "tmux" : "headless";
    const parallel = clampInt(body.parallel, 1, 8, 1);
    const samples = clampInt(body.samples, 1, 8, 1);
    const filter = {
      caseIds: cleanStrings(body.caseIds),
      categories: cleanStrings(body.categories),
      tags: cleanStrings(body.tags),
      difficulty: cleanStrings(body.difficulty),
    };
    // An explicit-but-empty selection must not fall through to "run everything".
    if (Array.isArray(body.caseIds) && filter.caseIds.length === 0) {
      return badRequest("caseIds must include at least one case id (omit the field entirely to run the filtered set)", { field: "caseIds" });
    }
    const harness = typeof body.harness === "string" && body.harness.trim() ? body.harness.trim() : undefined;
    // An unknown harness would otherwise create a run whose every case errors
    // at spawn time — reject it up front with the registered ids.
    if (harness && !hasAdapter(harness)) {
      const registered = listAdapters().map((a) => a.id).join(", ");
      return badRequest(`Unknown harness "${harness}". Registered harnesses: ${registered}`, { field: "harness" });
    }
    const normalizedFilter = Object.fromEntries(
      Object.entries(filter).filter(([, value]) => value.length > 0)
    );
    const result = await createAndStartRun({
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined,
      runner: runner as RunnerKind,
      harness,
      parallel,
      samples,
      model: typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined,
      filter: normalizedFilter,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Tag known case-selection failures so the wizard can render them inline
    // next to the offending control instead of as a bare error.
    const field = /no cases match/i.test(message) ? "caseIds" : undefined;
    return badRequest(message, field ? { field } : undefined);
  }
}

function cleanStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
