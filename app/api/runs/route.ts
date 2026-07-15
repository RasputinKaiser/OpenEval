import { NextResponse } from "next/server";
import { createAndStartRun } from "@/lib/run";
import { listRuns } from "@/lib/db";
import type { RunnerKind } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const runs = listRuns(10);
  const lite = runs.map((r) => ({ id: r.id, name: r.name, status: r.status }));
  return NextResponse.json(
    { runs: lite },
    { headers: { "Cache-Control": "private, max-age=10, stale-while-revalidate=30" } }
  );
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
      return NextResponse.json({ error: "caseIds must include at least one case id" }, { status: 400 });
    }
    const normalizedFilter = Object.fromEntries(
      Object.entries(filter).filter(([, value]) => value.length > 0)
    );
    const result = await createAndStartRun({
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined,
      runner: runner as RunnerKind,
      harness: typeof body.harness === "string" && body.harness.trim() ? body.harness.trim() : undefined,
      parallel,
      samples,
      model: typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined,
      filter: normalizedFilter,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
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
