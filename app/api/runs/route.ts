import { NextResponse } from "next/server";
import { createAndStartRun } from "@/lib/run";
import type { RunnerKind } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const runner = body.runner === "tmux" ? "tmux" : "headless";
    const parallel = clampInt(body.parallel, 1, 8, 1);
    const samples = clampInt(body.samples, 1, 8, 1);
    const filter = {
      caseIds: cleanStrings(body.caseIds),
      categories: cleanStrings(body.categories),
      tags: cleanStrings(body.tags),
      difficulty: cleanStrings(body.difficulty),
    };
    const normalizedFilter = Object.fromEntries(
      Object.entries(filter).filter(([, value]) => value.length > 0)
    );
    const result = await createAndStartRun({
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined,
      runner: runner as RunnerKind,
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
