import { NextResponse } from "next/server";
import { indexPendingFiles } from "@/lib/collection/search";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * One incremental FTS index pass — reads up to `max` transcripts and indexes
 * their text. Explicitly user-triggered (the client loops while `remaining`
 * is nonzero); never runs during a page render.
 */
export async function POST(req: Request) {
  let max = 25;
  try {
    const body = await req.json();
    if (typeof body?.max === "number" && Number.isFinite(body.max)) max = body.max;
  } catch {
    // empty body → defaults
  }
  return NextResponse.json(indexPendingFiles(max));
}
