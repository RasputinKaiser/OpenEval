import fs from "node:fs";
import type { JudgeSelection } from "../grader/selection";
import type { StoredJudgeReceipt, StoredJudgment } from "../live-cache";
import type { Marker, SessionPoint } from "./timeline";
import { TIMELINE_JUDGE_VERDICT_VERSION as JUDGE_PROMPT_VERSION } from "./judge-verdict";

export type JudgeReviewReason = "gap" | "uncertain" | "disagreement" | "changed" | "balanced";

export interface JudgeQueueFilters {
  from?: number;
  to?: number;
  source?: string;
  model?: string;
  reasons?: JudgeReviewReason[];
  limit?: number;
}

export interface JudgeQueueItem {
  path: string;
  sessionId: string;
  sourceId: string;
  source: string;
  model: string | null;
  at: number;
  reasons: JudgeReviewReason[];
  /** Stable priority: changed and evidence gaps precede routine balancing. */
  priority: number;
  receiptId?: string;
}

export interface JudgeQueuePreview {
  version: "judge-queue.v1";
  total: number;
  returned: number;
  truncated: boolean;
  counts: Record<JudgeReviewReason, number>;
  filters: JudgeQueueFilters;
  items: JudgeQueueItem[];
  packetBounds: { maxRecords: number; maxBytes: number; excerptChars: number };
  execution: { maxSessions: number; concurrency: 1 };
}

export interface JudgeQueueInput {
  points: SessionPoint[];
  markers?: Marker[];
  judgments?: Map<string, StoredJudgment>;
  receipts?: Map<string, StoredJudgeReceipt>;
  /** Optional packet classification from a bounded preview read. */
  evidence?: Map<string, { sufficiency: "sufficient" | "insufficient" | "unknown"; contentDigest?: string; revision?: string; available?: boolean }>;
  selection?: JudgeSelection;
  now?: number;
}

function inDateRange(point: SessionPoint, filters: JudgeQueueFilters): boolean {
  return (filters.from == null || point.at >= filters.from)
    && (filters.to == null || point.at < filters.to);
}

function currentReceipt(point: SessionPoint, input: JudgeQueueInput): StoredJudgeReceipt | undefined {
  return point.path ? input.receipts?.get(point.path) : undefined;
}

function reasonsFor(point: SessionPoint, input: JudgeQueueInput): JudgeReviewReason[] {
  if (!point.path) return ["uncertain"];
  const judgment = input.judgments?.get(point.path);
  const receipt = currentReceipt(point, input);
  const packet = input.evidence?.get(point.path);
  const reasons: JudgeReviewReason[] = [];
  if (!judgment && !receipt) reasons.push("gap");
  if (receipt?.outcome === "insufficient_evidence" && (!judgment || receipt.createdAt >= judgment.judgedAt)) reasons.push("uncertain");
  if (packet && packet.sufficiency === "insufficient") reasons.push("uncertain");
  if (judgment && (judgment.promptVersion !== JUDGE_PROMPT_VERSION || judgment.evidenceVersion !== "evidence-packet.v1")) reasons.push("changed");
  if (receipt && receipt.promptVersion !== JUDGE_PROMPT_VERSION) reasons.push("changed");
  if (receipt && packet?.contentDigest && receipt.evidenceDigest !== packet.contentDigest) reasons.push("changed");
  if (receipt && packet?.revision && receipt.revision !== packet.revision) reasons.push("changed");
  if (judgment && judgment.promptVersion !== JUDGE_PROMPT_VERSION) reasons.push("changed");
  const stored = receipt ?? judgment;
  if (stored && input.selection && !selectionMatchesReceipt(input.selection, stored)) reasons.push("changed");
  if (stored && (stored.sessionId !== point.sessionId || (stored.sourceId && stored.sourceId !== point.sourceId))) reasons.push("changed");
  if (judgment?.revision && packet?.revision && judgment.revision !== packet.revision) reasons.push("changed");
  const heuristicBaseline = point.heuristicOutcome ?? (point.outcomeProvenance === "judged" ? Number.NaN : point.outcome);
  if (judgment && (point.heuristicOutcomeHasSignal ?? point.outcomeProvenance !== "unavailable") && Number.isFinite(judgment.score)
    && Number.isFinite(heuristicBaseline) && Math.abs(judgment.score - heuristicBaseline) >= 0.25) reasons.push("disagreement");
  // A balanced queue is deliberately represented as a reason, so a preview
  // can disclose why a known-good row was selected for population coverage.
  if (!reasons.length) reasons.push("balanced");
  return [...new Set(reasons)];
}

function priority(reasons: JudgeReviewReason[]): number {
  if (reasons.includes("changed")) return 0;
  if (reasons.includes("gap")) return 1;
  if (reasons.includes("uncertain")) return 2;
  if (reasons.includes("disagreement")) return 3;
  return 4;
}

/**
 * Build a bounded review preview. Filters are applied before balancing and a
 * deterministic source/model/date round-robin keeps a large corpus from
 * becoming a newest-source-only queue.
 */
export function previewJudgeQueue(input: JudgeQueueInput, filters: JudgeQueueFilters = {}): JudgeQueuePreview {
  const requestedReasons = new Set(filters.reasons ?? []);
  const candidates = input.points
    .filter((point) => Boolean(point.path) && input.evidence?.get(point.path!)?.available !== false && inDateRange(point, filters))
    .filter((point) => !filters.source || point.source === filters.source || point.sourceId === filters.source)
    .filter((point) => !filters.model || point.model === filters.model)
    .map((point): JudgeQueueItem | null => {
      const reasons = reasonsFor(point, input);
      if (requestedReasons.size && !reasons.some((reason) => requestedReasons.has(reason))) return null;
      const receipt = currentReceipt(point, input);
      return {
        path: point.path!,
        sessionId: point.sessionId,
        sourceId: point.sourceId ?? point.source,
        source: point.source,
        model: point.model,
        at: point.at,
        reasons,
        priority: priority(reasons),
        ...(receipt?.receiptId ? { receiptId: receipt.receiptId } : {}),
      };
    })
    .filter((item): item is JudgeQueueItem => item !== null);

  const byBucket = new Map<string, JudgeQueueItem[]>();
  for (const item of candidates) {
    const key = `${item.sourceId}\u0000${item.model ?? "(unknown)"}`;
    const bucket = byBucket.get(key) ?? [];
    bucket.push(item);
    byBucket.set(key, bucket);
  }
  for (const bucket of byBucket.values()) bucket.sort((a, b) => a.at - b.at || a.path.localeCompare(b.path));
  const buckets = [...byBucket.values()].sort((a, b) => (a[0]?.sourceId ?? "").localeCompare(b[0]?.sourceId ?? ""));
  const ordered: JudgeQueueItem[] = [];
  for (let index = 0; buckets.some((bucket) => index < bucket.length); index++) {
    for (const bucket of buckets) {
      const item = bucket[index];
      if (item) ordered.push(item);
    }
  }
  // Keep the bucket round-robin order within each priority group. Sorting by
  // timestamp here would collapse a balanced preview back into one source's
  // chronological run. Keep the original index explicit for deterministic
  // behavior across runtimes.
  const queueOrder = new Map(ordered.map((item, index) => [item.path, index]));
  ordered.sort((a, b) => a.priority - b.priority || (queueOrder.get(a.path)! - queueOrder.get(b.path)!));
  const limit = Math.max(1, Math.min(Math.floor(filters.limit ?? 50), 50));
  const counts: Record<JudgeReviewReason, number> = { gap: 0, uncertain: 0, disagreement: 0, changed: 0, balanced: 0 };
  for (const item of ordered) for (const reason of item.reasons) counts[reason]++;
  return {
    version: "judge-queue.v1",
    total: ordered.length,
    returned: Math.min(limit, ordered.length),
    truncated: ordered.length > limit,
    counts,
    filters: { ...filters, limit },
    items: ordered.slice(0, limit),
    packetBounds: { maxRecords: 256, maxBytes: 4 * 1024 * 1024, excerptChars: 600 },
    execution: { maxSessions: 50, concurrency: 1 },
  };
}

/** Alias used by callers that describe this endpoint as a queue build. */
export const buildJudgeQueue = previewJudgeQueue;

/** A compact deterministic queue for serial execution. */
export function queueForJudge(input: JudgeQueueInput, filters: JudgeQueueFilters = {}): JudgeQueueItem[] {
  return previewJudgeQueue(input, { ...filters, limit: filters.limit ?? 50 }).items;
}

export function selectionMatchesReceipt(selection: JudgeSelection | undefined, receipt: Pick<StoredJudgeReceipt, "selection"> | undefined): boolean {
  if (!selection || !receipt?.selection) return false;
  return selection.source === receipt.selection.source
    && selection.model === receipt.selection.model
    && selection.reasoningEffort === receipt.selection.reasoningEffort;
}

/** Cheap eligibility metadata only; preview never rereads the entire corpus. */
export function judgeQueueMetadata(points: SessionPoint[]): NonNullable<JudgeQueueInput["evidence"]> {
  const metadata: NonNullable<JudgeQueueInput["evidence"]> = new Map();
  for (const point of points) {
    if (!point.path) continue;
    try {
      const stat = fs.statSync(point.path);
      metadata.set(point.path, { sufficiency: "unknown", available: stat.isFile(), revision: `${stat.mtimeMs}:${stat.size}:${point.pathBytes ?? 0}:${point.lineCount ?? 0}:${stat.ctimeMs}` });
    } catch { metadata.set(point.path, { sufficiency: "unknown", available: false }); }
  }
  return metadata;
}
