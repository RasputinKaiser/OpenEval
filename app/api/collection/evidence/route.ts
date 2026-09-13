import fs from "node:fs";
import { loadJudgeReceipts, loadLegacyJudgeHistory, loadJudgments } from "@/lib/live-cache";
import { TIMELINE_JUDGE_VERDICT_VERSION } from "@/lib/insights/judge-verdict";
import { JUDGE_EVIDENCE_OPTIONS } from "@/lib/insights/judge";
import { NextResponse } from "next/server";
import { resolveCollectionSession } from "@/lib/collection/resolver";
import { readEvidencePacket } from "@/lib/insights/evidence";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const failure = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

/** Read one bounded source-qualified packet only when explicitly requested. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const sourceId = params.get("sourceId") ?? "", sessionId = params.get("sessionId") ?? "";
  if (!sourceId || !sessionId || sourceId.length > 160 || sessionId.length > 512) return failure("A valid source and session identity are required.", 400);
  if ([...params.keys()].some(key => !["sourceId", "sessionId"].includes(key))) return failure("This endpoint accepts source and session identity only.", 400);
  try {
    const resolved = resolveCollectionSession({ sourceId, sessionId });
    if (!resolved) return failure("This session is not in the current collection inventory.", 404);
    if (!("file" in resolved)) return failure("Only the archived summary remains; transcript evidence is unavailable.", 410);
    const before = fs.statSync(resolved.file);
    const packet = readEvidencePacket(resolved.file, { sourceId, sessionId, format: resolved.spec.format, ...JUDGE_EVIDENCE_OPTIONS });
    const after = fs.statSync(resolved.file);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) return failure("This transcript changed while evidence was read. Refresh the packet.", 409);
    const history = loadJudgeReceipts(resolved.file).filter(receipt => receipt.sourceId === sourceId && receipt.sessionId === sessionId);
    const projection = loadJudgments().get(resolved.file);
    const legacy = [...loadLegacyJudgeHistory(resolved.file), ...(projection ? [projection] : [])].filter(judgment => judgment.sessionId === sessionId && (!judgment.sourceId || judgment.sourceId === sourceId));
    const historyKeys = new Set(history.map(receipt => `${receipt.createdAt}:${receipt.judge}`));
    const legacyByKey = new Map(legacy.map(judgment => [`${judgment.judgedAt}:${judgment.judge}`, judgment]));
    const legacyReceipts = [...legacyByKey].filter(([key]) => !historyKeys.has(key)).map(([key, judgment]) => ({
      receiptId: `legacy:${key}`, outcome: "legacy_review", score: judgment.score, confidence: "unavailable", reasons: judgment.reasons,
      evidenceIds: [], contradictionEvidenceIds: [], selection: judgment.selection, createdAt: judgment.judgedAt,
      promptVersion: judgment.promptVersion ?? 0, evidenceVersion: judgment.evidenceVersion ?? "legacy", evidenceMatches: false, promptMatches: judgment.promptVersion === TIMELINE_JUDGE_VERDICT_VERSION,
    }));
    const receipts = [...legacyReceipts, ...history.map(receipt => ({
      receiptId: receipt.receiptId, outcome: receipt.outcome, score: receipt.score, confidence: receipt.confidence,
      reasons: receipt.reasons, evidenceIds: receipt.evidenceIds, contradictionEvidenceIds: receipt.contradictionEvidenceIds,
      dimensions: receipt.dimensions, selection: receipt.selection, createdAt: receipt.createdAt,
      promptVersion: receipt.promptVersion, evidenceVersion: receipt.evidenceVersion,
      evidenceMatches: receipt.evidenceDigest === packet.contentDigest && receipt.evidenceVersion === packet.version,
      promptMatches: receipt.promptVersion === TIMELINE_JUDGE_VERDICT_VERSION,
    }))].sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
    return NextResponse.json({ packet, receipts, revision: `${after.size}:${after.mtimeMs}`, generatedAtMs: Date.now() }, { headers });
  } catch { return failure("The evidence source could not be read. Refresh the collection and try again.", 503); }
}
