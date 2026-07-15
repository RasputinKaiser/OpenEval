import { NextResponse } from "next/server";
import { getRun, listRunCases } from "@/lib/db";
import { sweepOrphanRunsIfDue } from "@/lib/run";
import type { RunCaseRecord } from "@/lib/types";

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

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  // Self-heal: runs stranded at "running" by a crash/recompile would otherwise
  // keep SSE streams and client polls alive forever.
  try { sweepOrphanRunsIfDue(); } catch {}
  const run = getRun(params.id);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  const cases = listRunCases(params.id);
  const url = new URL(request.url);
  const lite = url.searchParams.get("lite") === "1";
  const finalCases = lite ? stripHeavyFields(cases) : cases;
  const isTerminal = run.status === "completed" || run.status === "failed" || run.status === "aborted";
  const cacheHeaders = isTerminal && !lite
    ? { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" }
    : { "Cache-Control": "no-cache" };
  return NextResponse.json({ run, cases: finalCases }, { headers: cacheHeaders });
}
