import { NextResponse } from "next/server";
import { indexPendingFiles } from "@/lib/collection/search";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * One incremental FTS index pass — reads up to `max` transcripts and indexes
 * their text. Explicitly user-triggered (the client loops while `remaining`
 * is nonzero); never runs during a page render.
 *
 * Each file is one small write transaction, so a pass never starves other WAL
 * writers. The default time budget bounds a single request's wall time even
 * when the batch hits giant rollout files; a budget-cut pass reports
 * `budgetExhausted: true` with an honest `remaining`, and the client's normal
 * resume loop picks up where it stopped. Pass `budget_ms` to override.
 */
const DEFAULT_BUDGET_MS = 20_000;

export async function POST(req: Request) {
  let max = 25;
  let budgetMs = DEFAULT_BUDGET_MS;
  try {
    const body = await req.json();
    if (typeof body?.max === "number" && Number.isFinite(body.max)) max = body.max;
    if (typeof body?.budget_ms === "number" && Number.isFinite(body.budget_ms) && body.budget_ms >= 0) {
      budgetMs = Math.min(body.budget_ms, 250_000); // keep under maxDuration
    }
  } catch {
    // empty body → defaults
  }
  return NextResponse.json(indexPendingFiles(max, { budgetMs }));
}
