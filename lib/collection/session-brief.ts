import type { EvidencePacket, EvidenceRecord } from "../insights/evidence";

export type SessionBriefStatus = "pass" | "fail" | "mixed" | "unknown";

export interface SessionBriefCitation {
  evidenceId: string;
  kind: EvidenceRecord["kind"];
  status: EvidenceRecord["status"];
  excerpt: string;
  claimed: boolean;
}

export interface SessionBriefQuote {
  evidenceId: string;
  excerpt: string;
  claimed: boolean;
  label: string;
  provenance: "request" | "assistant_output" | "final_receipt";
  finality: "known" | "unknown";
}

export interface SessionBriefAttempt {
  attempt: number;
  tool: string;
  /** Bounded source call arguments, kept separate from the citation excerpt. */
  excerpt: string;
  status: SessionBriefStatus;
  summary: string;
  evidenceIds: string[];
}

export interface SessionBriefCheck {
  status: SessionBriefStatus;
  summary: string;
  evidenceIds: string[];
}

export interface SessionBriefUnresolved {
  status: SessionBriefStatus;
  summary: string;
  evidenceIds: string[];
}

export interface SessionBrief {
  version: "session-brief.v1";
  sourceId: string;
  sessionId: string;
  /** Transport completion is retained as a separate, always evidence-linked dimension. */
  completion: SessionBriefCheck;
  request: SessionBriefQuote | null;
  final: SessionBriefQuote | null;
  attempts: SessionBriefAttempt[];
  checks: SessionBriefCheck[];
  unresolved: SessionBriefUnresolved[];
  citations: SessionBriefCitation[];
  bounds: {
    attemptLimit: number;
    attemptsOmitted: number;
    recordsRetained: number;
    truncated: boolean;
    unsupported: boolean;
    unsupportedFormat: boolean;
    unsupportedRecords: boolean;
  };
}

export interface BuildSessionBriefOptions {
  maxAttempts?: number;
}

const DEFAULT_MAX_ATTEMPTS = 12;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function recordById(packet: EvidencePacket, evidenceId: string | undefined): EvidenceRecord | undefined {
  return evidenceId ? packet.records.find((record) => record.evidenceId === evidenceId) : undefined;
}

function citationIds(value: { evidenceIds: string[] }): string[] {
  return unique(value.evidenceIds);
}

function quote(
  record: EvidenceRecord | undefined,
  metadata: Pick<SessionBriefQuote, "label" | "provenance" | "finality">,
): SessionBriefQuote | null {
  return record
    ? { evidenceId: record.evidenceId, excerpt: record.excerpt, claimed: record.claimed === true, ...metadata }
    : null;
}

function statusForResult(record: EvidenceRecord | undefined, fallback: SessionBriefStatus): SessionBriefStatus {
  if (!record || record.status === "unknown" || record.missingOutput || record.unsupported || record.truncated) return "unknown";
  if (record.error || record.status === "failure") return "fail";
  return fallback;
}

function statusForCheck(record: EvidenceRecord): SessionBriefStatus {
  if (record.status === "unknown" || record.missingOutput || record.unsupported || record.truncated) return "unknown";
  if (record.error || record.status === "failure") return "fail";
  return /(?:^|\b)(?:exit code:\s*0|passed|passing|succeeded|success)(?:\b|$)/i.test(record.excerpt) ? "pass" : "unknown";
}

function resultForCall(packet: EvidencePacket, callId: string | undefined): EvidenceRecord | undefined {
  if (!callId) return undefined;
  return packet.records.find((record) => record.tool?.phase === "result" && record.tool.callId === callId);
}

function boundedCalls(calls: EvidenceRecord[], maxAttempts: number): EvidenceRecord[] {
  if (calls.length <= maxAttempts) return calls;
  const headCount = Math.max(1, Math.floor(maxAttempts / 3));
  const tailCount = maxAttempts - headCount;
  return tailCount > 0 ? [...calls.slice(0, headCount), ...calls.slice(-tailCount)] : calls.slice(0, headCount);
}

function boundaryItems(packet: EvidencePacket): SessionBriefUnresolved[] {
  const boundaryIds = packet.records
    .filter((record) => record.missingOutput || record.unsupported || record.truncated)
    .map((record) => record.evidenceId);
  const items: SessionBriefUnresolved[] = [];
  if (packet.bounds.truncated) {
    items.push({ status: "unknown", summary: "The retained evidence window was truncated; omitted records may change the unresolved picture.", evidenceIds: boundaryIds });
  }
  if (packet.format === "unsupported") {
    items.push({ status: "unknown", summary: "This source format is unsupported; session intent and outcome remain unknown.", evidenceIds: boundaryIds });
  }
  if (packet.format !== "unsupported" && packet.records.some((record) => record.unsupported)) {
    items.push({ status: "unknown", summary: "Some retained records have an unsupported shape; the complete session picture remains unknown.", evidenceIds: boundaryIds });
  }
  if (packet.bounds.malformedRecords > 0 || packet.bounds.omittedRecords > 0) {
    items.push({ status: "unknown", summary: "Some source records were malformed or omitted; the retained packet cannot establish a complete session brief.", evidenceIds: boundaryIds });
  }
  return items;
}

/**
 * Build a small, deterministic view over one already-bounded evidence packet.
 * This function never interprets transport completion or assistant prose as
 * proof that the user's goal was achieved.
 */
export function buildSessionBrief(packet: EvidencePacket, options: BuildSessionBriefOptions = {}): SessionBrief {
  const configuredLimit = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const maxAttempts = Math.min(50, Math.max(1, Number.isFinite(configuredLimit) ? Math.floor(configuredLimit) : DEFAULT_MAX_ATTEMPTS));
  const request = quote(
    recordById(packet, packet.openingAskEvidenceId) ?? packet.records.find((record) => record.kind === "request"),
    { label: "Request", provenance: "request", finality: "known" },
  );
  // Prefer the last assistant response as the quoted final. A turn.completed
  // record is retained separately as transport evidence and should not hide
  // the actual response text when both records are present.
  const finalReceipt = recordById(packet, packet.finalOutputEvidenceId);
  const assistantOutput = [...packet.records].reverse().find((record) => record.kind === "assistant_output");
  const final = finalReceipt && finalReceipt.kind === "final_output" && finalReceipt.role !== "meta"
    ? quote(finalReceipt, { label: "Final output", provenance: "final_receipt", finality: "known" })
    : quote(assistantOutput, { label: "Retained assistant output", provenance: "assistant_output", finality: "unknown" });
  const completion = packet.evaluation.completionEvidence;
  const completionBrief: SessionBriefCheck = {
    status: completion.status,
    summary: completion.summary || completion.outcome,
    evidenceIds: unique(completion.evidenceIds),
  };

  const calls = boundedCalls(packet.records.filter((record) => record.kind === "tool_call"), maxAttempts);
  const attempts = calls.map((call, index) => {
    const result = resultForCall(packet, call.tool?.callId);
    const evidenceIds = unique([call.evidenceId, ...(result ? [result.evidenceId] : [])]);
    const status = statusForResult(result, result ? "pass" : "unknown");
    const resultLabel = result ? (status === "unknown" ? "unknown result" : status === "fail" ? "failed" : "completed") : "no retained result";
    return {
      attempt: index + 1,
      tool: call.tool?.name || "unknown tool",
      excerpt: call.excerpt.length > 160 ? `${call.excerpt.slice(0, 159)}…` : call.excerpt,
      status,
      summary: `${call.tool?.name || "Unknown tool"} attempt recorded with ${resultLabel}.`,
      evidenceIds,
    };
  });

  const verification = packet.evaluation.verification;
  const checks: SessionBriefCheck[] = verification.evidenceIds.length > 0
    ? boundedCalls(packet.records.filter((record) => verification.evidenceIds.includes(record.evidenceId)), maxAttempts).map((record) => ({
      status: statusForCheck(record),
      summary: record.error || record.status === "failure"
        ? "An observed verification receipt reports failure."
        : record.status === "unknown" || record.missingOutput
          ? "A verification receipt is present but its output is unknown."
          : "An observed verification receipt reports a check result.",
      evidenceIds: [record.evidenceId],
    }))
    : [{ status: "unknown", summary: verification.summary || "No observed verification receipt is retained; assistant test claims are not checks.", evidenceIds: [] }];

  const unresolved: SessionBriefUnresolved[] = [{
    status: packet.evaluation.unresolvedIssues.status,
    summary: packet.evaluation.unresolvedIssues.summary || packet.evaluation.unresolvedIssues.outcome,
    evidenceIds: unique(packet.evaluation.unresolvedIssues.evidenceIds),
  }, ...boundaryItems(packet)];

  const referencedIds = new Set<string>();
  if (request) referencedIds.add(request.evidenceId);
  if (final) referencedIds.add(final.evidenceId);
  for (const evidenceId of completionBrief.evidenceIds) referencedIds.add(evidenceId);
  for (const item of [...attempts, ...checks, ...unresolved]) for (const evidenceId of citationIds(item)) referencedIds.add(evidenceId);
  const citations = packet.records
    .filter((record) => referencedIds.has(record.evidenceId))
    .map((record) => ({
      evidenceId: record.evidenceId,
      kind: record.kind,
      status: record.status,
      excerpt: record.excerpt,
      claimed: record.claimed === true,
    }));

  return {
    version: "session-brief.v1",
    sourceId: packet.sourceId,
    sessionId: packet.sessionId,
    completion: completionBrief,
    request,
    final,
    attempts,
    checks,
    unresolved,
    citations,
    bounds: {
      attemptLimit: maxAttempts,
      attemptsOmitted: Math.max(0, packet.records.filter((record) => record.kind === "tool_call").length - attempts.length),
      recordsRetained: packet.bounds.recordsRetained,
      truncated: packet.bounds.truncated,
      unsupported: packet.bounds.unsupported || packet.records.some((record) => record.unsupported),
      unsupportedFormat: packet.format === "unsupported",
      unsupportedRecords: packet.records.some((record) => record.unsupported),
    },
  };
}
