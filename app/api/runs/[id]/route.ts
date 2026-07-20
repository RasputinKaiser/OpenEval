import { NextResponse } from "next/server";
import { z } from "zod";
import { getRun, listRunCases } from "@/lib/db";
import { sweepOrphanRunsIfDue } from "@/lib/run";
import type { RunCaseRecord } from "@/lib/types";
import { internalError, notFound, parseQuery, queryFlag } from "@/lib/api-http";

export const dynamic = "force-dynamic";

function stripHeavyFields(cases: RunCaseRecord[]): RunCaseRecord[] {
  return cases.map((c) => {
    if (!c.runner_result) return c;
    const runner = { ...c.runner_result };
    runner.rawJson = null;
    runner.toolCalls = runner.toolCalls.map((tc) => ({
      ...tc,
      input: typeof tc.input === "string" ? tc.input.slice(0, 200) : tc.input,
      output: tc.output?.slice(0, 200),
    }));
    runner.finalText = runner.finalText.slice(0, 500);
    if (c.grader_result) {
      const grader = { ...c.grader_result };
      grader.results = grader.results.map((g) => ({ ...g, output: undefined }));
      return { ...c, runner_result: runner, grader_result: grader };
    }
    return { ...c, runner_result: runner };
  });
}

const querySchema = z.object({ lite: queryFlag });

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const query = parseQuery(request, querySchema);
  if (!query.ok) return query.response;
  const lite = query.data.lite;
  // Self-heal: runs stranded at "running" by a crash/recompile would otherwise
  // keep SSE streams and client polls alive forever.
  try { sweepOrphanRunsIfDue(); } catch {}
  try {
    const run = getRun(params.id);
    if (!run) {
      return notFound("Run not found", { detail: `No run with id "${params.id}".` });
    }
    const cases = listRunCases(params.id);
    const finalCases = lite ? stripHeavyFields(cases) : cases;
    const isTerminal = run.status === "completed" || run.status === "failed" || run.status === "aborted";
    const cacheHeaders = isTerminal && !lite
      ? { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" }
      : { "Cache-Control": "no-cache" };
    return NextResponse.json({ run, cases: finalCases }, { headers: cacheHeaders });
  } catch (error) {
    return internalError("Failed to load run", error);
  }
}
