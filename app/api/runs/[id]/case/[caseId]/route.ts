import { NextResponse } from "next/server";
import { boundEvaluation, boundRunnerResult, getRun, getRunCaseByCaseId } from "@/lib/db";
import { isTerminalCaseStatus } from "@/lib/status";
import { internalError, notFound } from "@/lib/api-http";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  props: { params: Promise<{ id: string; caseId: string }> }
) {
  const params = await props.params;
  try {
    const run = getRun(params.id);
    if (!run) {
      return notFound("Run not found", { detail: `No run with id "${params.id}".` });
    }
    const rc = getRunCaseByCaseId(params.id, params.caseId);
    if (!rc) {
      return notFound("Case not found", { detail: `Run "${params.id}" has no case "${params.caseId}".` });
    }
    // Re-bound on read as an explicit compatibility path for rows written by
    // older versions before the SQLite projection caps were introduced.
    const boundedCase = {
      ...rc,
      runner_result: rc.runner_result ? boundRunnerResult(rc.runner_result) : null,
      grader_result: rc.grader_result ? boundEvaluation(rc.grader_result) : null,
      evaluation: rc.evaluation ? boundEvaluation(rc.evaluation) : null,
    };
    const isTerminal = isTerminalCaseStatus(rc.status);
    const cacheHeaders = isTerminal
      ? { "Cache-Control": "private, max-age=120, stale-while-revalidate=600" }
      : { "Cache-Control": "no-cache" };
    return NextResponse.json({ case: boundedCase }, { headers: cacheHeaders });
  } catch (error) {
    return internalError("Failed to load case", error);
  }
}
