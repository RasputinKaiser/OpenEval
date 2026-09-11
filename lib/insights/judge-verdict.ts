import { z } from "zod";
import { extractJudgeJson } from "../grader/judge";
import type { EvidencePacket } from "./evidence";

/** The versioned response contract used by Timeline judging. */
export const TIMELINE_JUDGE_VERDICT_VERSION = 4;
export const TIMELINE_JUDGE_CONTRACT = "openeval.timeline-judge";

export const JudgeOutcomeSchema = z.enum(["achieved", "partial", "not_achieved", "insufficient_evidence"]);
export const JudgeDimensionStatusSchema = z.enum(["pass", "fail", "mixed", "unknown"]);
const JudgeDimensionSchema = z.union([
  JudgeDimensionStatusSchema,
  z.object({
    status: JudgeDimensionStatusSchema,
    evidenceIds: z.array(z.string().trim().min(1).max(160)).max(24),
    summary: z.string().trim().max(240),
  }).strict(),
]);

export const JudgeVerdictSchema = z.object({
  outcome: JudgeOutcomeSchema,
  score: z.number().finite().min(0).max(1).nullable().optional(),
  confidence: z.enum(["high", "medium", "low"]),
  reasons: z.array(z.string().trim().min(1).max(240)).max(4),
  evidenceIds: z.array(z.string().trim().min(1).max(160)).max(24),
  contradictionEvidenceIds: z.array(z.string().trim().min(1).max(160)).max(24),
  dimensions: z.object({
    completion: JudgeDimensionSchema,
    verification: JudgeDimensionSchema,
    recovery: JudgeDimensionSchema,
    unresolvedIssues: JudgeDimensionSchema,
    sufficiency: z.union([z.enum(["sufficient", "insufficient", "unknown"]), JudgeDimensionSchema]),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  const hasScore = value.score !== undefined && value.score !== null;
  if (value.outcome === "insufficient_evidence" && hasScore) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["score"], message: "insufficient-evidence verdicts cannot include a numeric score" });
  }
  if (value.outcome !== "insufficient_evidence" && !hasScore) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["score"], message: "quality verdicts require a numeric score" });
  }
  if (value.outcome === "insufficient_evidence" && value.confidence === "high") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["confidence"], message: "insufficient-evidence verdicts cannot have high confidence" });
  }
});

export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;
export type JudgeOutcome = z.infer<typeof JudgeOutcomeSchema>;
export type JudgeDimensionStatus = z.infer<typeof JudgeDimensionStatusSchema>;

export interface ParsedJudgeVerdict {
  verdict: JudgeVerdict | null;
  error?: string;
}

function dimensionEvidenceIds(value: JudgeVerdict["dimensions"]["completion"]): string[] {
  return typeof value === "string" ? [] : value.evidenceIds;
}

function dimensionStatus(value: JudgeVerdict["dimensions"]["completion"] | JudgeVerdict["dimensions"]["sufficiency"]): string {
  return typeof value === "string" ? value : value.status;
}

const formatIssues = (error: z.ZodError): string => error.issues
  .slice(0, 6)
  .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
  .join("; ");

/**
 * Validate a provider response and bind every cited id to the retained packet.
 * A model may quote arbitrary transcript text, but it cannot manufacture an
 * evidence reference that the packet did not retain.
 */
export function validateJudgeVerdict(value: unknown, packet?: EvidencePacket, promptEvidenceIds?: Set<string>): ParsedJudgeVerdict {
  const parsed = JudgeVerdictSchema.safeParse(value);
  if (!parsed.success) return { verdict: null, error: `invalid Timeline judge verdict: ${formatIssues(parsed.error)}` };
  const verdict = parsed.data;
  const dimensionValues = [
    verdict.dimensions.completion,
    verdict.dimensions.verification,
    verdict.dimensions.recovery,
    verdict.dimensions.unresolvedIssues,
    verdict.dimensions.sufficiency,
  ];
  const citedIds = [
    ...verdict.evidenceIds,
    ...verdict.contradictionEvidenceIds,
    ...dimensionValues.flatMap((dimension) => dimensionEvidenceIds(dimension as JudgeVerdict["dimensions"]["completion"])),
  ];
  if (packet) {
    const known = new Set(packet.records.map((record) => record.evidenceId));
    const unknownIds = citedIds.filter((id) => !known.has(id));
    if (unknownIds.length) {
      return { verdict: null, error: `invalid Timeline judge verdict: unknown evidence id ${unknownIds[0]}` };
    }
    if (promptEvidenceIds) {
      const omittedIds = citedIds.filter((id) => !promptEvidenceIds.has(id));
      if (omittedIds.length) {
        return { verdict: null, error: `invalid Timeline judge verdict: evidence id was omitted from supplied prompt ${omittedIds[0]}` };
      }
      if (promptEvidenceIds.size < packet.records.length && verdict.outcome !== "insufficient_evidence") {
        return { verdict: null, error: "invalid Timeline judge verdict: omitted prompt records require insufficient_evidence" };
      }
    }
    if (packet.bounds.truncated || packet.bounds.unsupported || packet.bounds.omittedRecords > 0) {
      if (verdict.outcome !== "insufficient_evidence") {
        return { verdict: null, error: "invalid Timeline judge verdict: incomplete packet requires insufficient_evidence" };
      }
    }
    for (const key of ["verification", "recovery", "unresolvedIssues"] as const) {
      const dimension = verdict.dimensions[key];
      if (dimensionStatus(dimension) === "unknown") continue;
      const references = dimensionEvidenceIds(dimension).map(id => packet.records.find(record => record.evidenceId === id)!);
      const receipts = references.filter(record => record.observed && !record.claimed && !record.unsupported && !record.missingOutput && (record.kind === "tool_result" || record.kind === "error"));
      if (!receipts.length) return { verdict: null, error: `invalid Timeline judge verdict: ${key} requires observed execution receipts, not assistant claims` };
      if (key === "verification" && dimensionStatus(dimension) === "pass" && !receipts.some(record => record.tags.includes("tool_success"))) {
        return { verdict: null, error: "invalid Timeline judge verdict: passing verification requires an observed successful check" };
      }
      if (key === "recovery" && dimensionStatus(dimension) === "pass" && packet.records.some(record => record.error || record.status === "failure") && (!receipts.some(record => record.error || record.status === "failure") || !receipts.some(record => record.tags.includes("tool_success")))) {
        return { verdict: null, error: "invalid Timeline judge verdict: recovery requires failure and subsequent success receipts" };
      }
    }
    // Assistant output may be the deliverable for writing, research, or chat.
    // It is retained as citeable context. Execution claims still need observed
    // receipts because the prompt explicitly separates those dimensions.
  }
  if (verdict.outcome !== "insufficient_evidence" && verdict.evidenceIds.length === 0) {
    return { verdict: null, error: "invalid Timeline judge verdict: quality outcomes require at least one evidence id" };
  }
  if (verdict.outcome === "achieved" && (verdict.score ?? 0) <= 0) {
    return { verdict: null, error: "invalid Timeline judge verdict: achieved cannot have score 0" };
  }
  if (verdict.outcome === "not_achieved" && (verdict.score ?? 1) > 0.5) {
    return { verdict: null, error: "invalid Timeline judge verdict: not_achieved cannot have score above 0.5" };
  }
  if (verdict.outcome === "achieved" && (dimensionStatus(verdict.dimensions.completion) !== "pass" || dimensionStatus(verdict.dimensions.unresolvedIssues) === "fail")) {
    return { verdict: null, error: "invalid Timeline judge verdict: achieved contradicts completion or unresolved issues" };
  }
  if (verdict.outcome === "partial" && ((verdict.score ?? 0) <= 0 || (verdict.score ?? 1) >= 1)) {
    return { verdict: null, error: "invalid Timeline judge verdict: partial requires a score strictly between 0 and 1" };
  }
  const sufficiencyStatus = dimensionStatus(verdict.dimensions.sufficiency as JudgeVerdict["dimensions"]["completion"]);
  if (verdict.outcome !== "insufficient_evidence" && sufficiencyStatus !== "sufficient") {
    return { verdict: null, error: "invalid Timeline judge verdict: quality outcomes require sufficient evidence" };
  }
  return { verdict };
}

/** Extract, parse, and validate a bounded provider response. */
export function parseJudgeVerdict(text: string, packet?: EvidencePacket, promptEvidenceIds?: Set<string>): ParsedJudgeVerdict {
  const json = extractJudgeJson(text);
  if (!json) return { verdict: null, error: "invalid Timeline judge verdict: no JSON object found" };
  return validateJudgeVerdict(json, packet, promptEvidenceIds);
}

export interface JudgeReceiptEvidence {
  /** Stable normalized packet digest, independent of the absolute file path. */
  evidenceDigest: string;
  evidenceVersion: string;
  /** Source revision used while building the packet. */
  revision: string;
  sourceId: string;
  evidenceIds: string[];
  contradictionEvidenceIds: string[];
  sufficiency: EvidencePacket["evaluation"]["sufficiency"];
}

/** A deterministic local evaluation used only with the transport stub. */
export function evaluateDeterministicEvidence(packet: EvidencePacket, options: { evidenceIds?: Set<string> } = {}): JudgeVerdict {
  const allowed = options.evidenceIds;
  const retain = (id: string) => !allowed || allowed.has(id);
  const evidenceIds = packet.evaluation.observedEvidenceIds.filter(retain).slice(0, 24);
  const contradictionEvidenceIds = [
    ...packet.evaluation.unresolvedIssues.evidenceIds,
    ...packet.evaluation.completionEvidence.evidenceIds,
  ].filter(retain).filter((id, index, all) => all.indexOf(id) === index).slice(0, 24);
  const dimension = (value: { status: "pass" | "fail" | "mixed" | "unknown"; evidenceIds: string[]; summary: string }) => ({
    status: value.status,
    evidenceIds: value.evidenceIds.filter(retain).slice(0, 24),
    summary: value.summary.slice(0, 240),
  });
  const dimensions = {
    completion: dimension(packet.evaluation.completionEvidence),
    verification: dimension(packet.evaluation.verification),
    recovery: dimension(packet.evaluation.recovery),
    unresolvedIssues: dimension(packet.evaluation.unresolvedIssues),
    sufficiency: packet.evaluation.sufficiency,
  } as const;
  // This evaluator describes source evidence. It never promotes a passing
  // test into a goal-quality score or a failure in an unrelated tool into a
  // numeric outcome.
  if (packet.evaluation.sufficiency !== "sufficient" || packet.evaluation.completionEvidence.status === "unknown") {
    return {
      outcome: "insufficient_evidence",
      score: null,
      confidence: "low",
      reasons: ["retained evidence does not establish goal completion"],
      evidenceIds,
      contradictionEvidenceIds,
      dimensions,
    };
  }
  if (packet.evaluation.unresolvedIssues.status === "fail") {
    return {
      outcome: "insufficient_evidence",
      score: null,
      confidence: "medium",
      reasons: ["an observed issue remains unresolved; quality outcome requires review"],
      evidenceIds,
      contradictionEvidenceIds,
      dimensions,
    };
  }
  return {
    outcome: "insufficient_evidence",
    score: null,
    confidence: "low",
    reasons: ["observed receipts describe execution but do not prove goal quality"],
    evidenceIds,
    contradictionEvidenceIds,
    dimensions,
  };
}
