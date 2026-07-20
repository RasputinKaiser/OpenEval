import { NextResponse } from "next/server";
import { getRun, listRunCases, updateRunStatus } from "@/lib/db";
import { requestRunCancel } from "@/lib/run";
import { computeSummary } from "@/lib/summary";
import { conflict, internalError, notFound } from "@/lib/api-http";

export const dynamic = "force-dynamic";

// Next returns 405 automatically for methods without an exported handler.
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const run = getRun(params.id);
  if (!run) {
    return notFound("Run not found", { detail: `No run with id "${params.id}".` });
  }
  if (run.status !== "running") {
    return conflict(`Run is ${run.status}; only running runs can be cancelled`);
  }
  try {
    // DB first: the run loop treats the row's "aborted" status as the source of
    // truth, so cancellation lands even when dev HMR reset the in-process
    // registry. The loop recomputes the summary once in-flight cases finish;
    // this interim one keeps the UI truthful meanwhile.
    updateRunStatus(params.id, "aborted", Date.now(), computeSummary(listRunCases(params.id)));
    requestRunCancel(params.id);
    return NextResponse.json({ run: getRun(params.id) });
  } catch (error) {
    return internalError("Failed to cancel run", error);
  }
}
