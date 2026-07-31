import { NextResponse } from "next/server";
import { createAndStartRun } from "@/lib/run";
import { listRuns } from "@/lib/db";
import { hasAdapter, listAdapters } from "@/lib/adapters/registry";
import { probeHarness } from "@/lib/adapters/discover";
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
    const parsedBody: unknown = await req.json().catch(() => undefined);
    if (!isRecord(parsedBody)) {
      return badRequest("Request body must be a JSON object");
    }
    const body = parsedBody;
    const runner = body.runner === undefined ? "headless" : body.runner;
    if (runner !== "headless" && runner !== "tmux") {
      return badRequest("runner must be headless or tmux", { field: "runner" });
    }
    const parallel = parseBoundedInt(body.parallel, "parallel");
    if (parallel.value === null) return badRequest(parallel.error, { field: "parallel" });
    const samples = parseBoundedInt(body.samples, "samples");
    if (samples.value === null) return badRequest(samples.error, { field: "samples" });
    const parsedArrays = (Object.entries({
      caseIds: "case ids",
      categories: "categories",
      tags: "tags",
      difficulty: "difficulty values",
    }) as Array<["caseIds" | "categories" | "tags" | "difficulty", string]>).map(([field, label]) => [
      field,
      parseStringArray(body[field], label),
    ] as const);
    for (const [field, parsed] of parsedArrays) {
      if (parsed.error) return badRequest(parsed.error, { field });
    }
    const filter = Object.fromEntries(parsedArrays.map(([field, parsed]) => [field, parsed.value])) as {
      caseIds: string[];
      categories: string[];
      tags: string[];
      difficulty: string[];
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
    if (harness) {
      const discovered = await probeHarness(harness);
      if (!discovered || discovered.status !== "available") {
        const detail = discovered?.detail ? ` ${discovered.detail}` : " Refresh harness discovery and fix the local CLI before launching.";
        return badRequest(`Harness "${harness}" is unavailable.${detail}`, { field: "harness" });
      }
    }
    const normalizedFilter = Object.fromEntries(
      Object.entries(filter).filter(([, value]) => value.length > 0)
    );
    const result = await createAndStartRun({
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined,
      runner: runner as RunnerKind,
      harness,
      parallel: parallel.value,
      samples: samples.value,
      model: typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined,
      filter: normalizedFilter,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return startRunErrorResponse(error);
  }
}

function startRunErrorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  // Known selection/registry failures are caller errors; unexpected failures
  // must remain 500s so clients do not retry malformedly or call infrastructure
  // faults a bad request.
  if (/no cases match/i.test(message)) return badRequest(message, { field: "caseIds" });
  if (/unknown harness/i.test(message)) return badRequest(message, { field: "harness" });
  return internalError("Failed to start run", error);
}

function parseStringArray(value: unknown, label: string): { value: string[]; error: string | null } {
  if (value === undefined) return { value: [], error: null };
  if (!Array.isArray(value)) return { value: [], error: `${label} must be an array of strings` };
  if (value.some((item) => typeof item !== "string")) {
    return { value: [], error: `${label} must contain only strings` };
  }
  const values = (value as string[]).map((item) => item.trim());
  if (values.some((item) => item.length === 0)) {
    return { value: [], error: `${label} must not contain blank values` };
  }
  return { value: [...new Set(values)], error: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseBoundedInt(value: unknown, field: "parallel" | "samples"): { value: number; error: null } | { value: null; error: string } {
  if (value === undefined) return { value: 1, error: null };
  const raw = typeof value === "string" ? value.trim() : value;
  const valid = (typeof raw === "number" && Number.isInteger(raw)) || (typeof raw === "string" && /^\d+$/.test(raw));
  const parsed = valid ? Number(raw) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) {
    return { value: null, error: `${field} must be an integer between 1 and 8` };
  }
  return { value: parsed, error: null };
}
