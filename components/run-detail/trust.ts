import type { EvidenceTier, GraderResult, GraderSpec, RunCaseRecord } from "@/lib/types";

/**
 * Pure confidence/trust math for the run detail surface. Kept free of React so
 * the scoring contract is unit-testable — the numbers shown in the confidence
 * layer and per-case trust chips all come from here.
 */

export type EvidenceCounts = Record<EvidenceTier, { passed: number; total: number }>;

export interface CaseTrustSummary {
  score: number;
  grade: string;
  hasOracle: boolean;
  hasKnownBad: boolean;
  hasBudget: boolean;
  hasVisualContract: boolean;
  hasProofBackstop: boolean;
  evidence: EvidenceCounts;
  weaknesses: string[];
}

export interface RunConfidenceSummary {
  score: number;
  grade: string;
  totalCases: number;
  provenCaseCount: number;
  knownBadCaseCount: number;
  weakCaseCount: number;
  deterministicCoverage: number;
  knownBadCoverage: number;
  oracleCoverage: number;
  visualCoverage: number;
  topWeaknesses: Array<{ label: string; count: number }>;
}

export function summarizeRunConfidence(cases: RunCaseRecord[]): RunConfidenceSummary {
  const totalCases = cases.length || 1;
  const trusts = cases.map((c) => summarizeCaseTrust(c));
  const provenCaseCount = trusts.filter((t) => t.hasProofBackstop).length;
  const knownBadCaseCount = trusts.filter((t) => t.hasKnownBad).length;
  const oracleCaseCount = trusts.filter((t) => t.hasOracle).length;
  const visualCaseCount = cases.filter((c) => c.case_def.visual).length;
  const visualContractCount = trusts.filter((t) => t.hasVisualContract).length;
  const weakCaseCount = trusts.filter((t) => t.weaknesses.length > 0).length;
  const passRatio = cases.length ? cases.filter((c) => c.status === "passed").length / cases.length : 0;
  const deterministicCoverage = Math.round((provenCaseCount / totalCases) * 100);
  const knownBadCoverage = Math.round((knownBadCaseCount / totalCases) * 100);
  const oracleCoverage = Math.round((oracleCaseCount / totalCases) * 100);
  const visualCoverage = visualCaseCount ? Math.round((visualContractCount / visualCaseCount) * 100) : 100;
  const avgCaseTrust = trusts.length ? trusts.reduce((sum, t) => sum + t.score, 0) / trusts.length : 0;
  const score = clampScore(
    passRatio * 30 +
    avgCaseTrust * 0.35 +
    deterministicCoverage * 0.15 +
    knownBadCoverage * 0.1 +
    oracleCoverage * 0.05 +
    visualCoverage * 0.05
  );

  const weaknessCounts = new Map<string, number>();
  for (const trust of trusts) {
    for (const weakness of trust.weaknesses) {
      weaknessCounts.set(weakness, (weaknessCounts.get(weakness) ?? 0) + 1);
    }
  }

  return {
    score,
    grade: confidenceGrade(score),
    totalCases: cases.length,
    provenCaseCount,
    knownBadCaseCount,
    weakCaseCount,
    deterministicCoverage,
    knownBadCoverage,
    oracleCoverage,
    visualCoverage,
    topWeaknesses: Array.from(weaknessCounts, ([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}

export function summarizeCaseTrust(rc: RunCaseRecord): CaseTrustSummary {
  const evidence = summarizeEvidence(rc.grader_result?.results ?? []);
  const hasOracle = !!(rc.case_def.oracle?.solve || rc.case_def.oracle?.final_text);
  const hasKnownBad = !!rc.case_def.oracle?.known_bad?.length;
  const hasBudget = !!rc.case_def.budget;
  const hasVisualContract = !rc.case_def.visual || !!rc.case_def.visual.expected_artifacts?.length;
  const hasProofBackstop = evidence.deterministic.total + evidence.trace.total > 0;
  const weaknesses: string[] = [];

  if (!hasOracle) weaknesses.push("missing oracle");
  if (!hasKnownBad) weaknesses.push("no known-bad");
  if (!hasProofBackstop) weaknesses.push("no deterministic/trace proof");
  if (evidence.llm_judge.total > 0 && evidence.deterministic.total === 0) weaknesses.push("LLM judge lacks backstop");
  if (!hasBudget) weaknesses.push("no budget");
  if (rc.case_def.visual && !hasVisualContract) weaknesses.push("visual has no artifacts");
  if (evidence.manual.total > 0) weaknesses.push("manual grader");

  const deterministicRatio = ratio(evidence.deterministic.passed + evidence.trace.passed, evidence.deterministic.total + evidence.trace.total);
  const allGraderRatio = rc.grader_result ? rc.grader_result.passRatio : statusRatio(rc.status);
  const metadataScore =
    (hasOracle ? 15 : 0) +
    (hasKnownBad ? 15 : 0) +
    (hasBudget ? 8 : 0) +
    (hasVisualContract ? 7 : 0);
  const score = clampScore(allGraderRatio * 35 + deterministicRatio * 20 + metadataScore - Math.max(0, weaknesses.length - 1) * 5);

  return {
    score,
    grade: confidenceGrade(score),
    hasOracle,
    hasKnownBad,
    hasBudget,
    hasVisualContract,
    hasProofBackstop,
    evidence,
    weaknesses,
  };
}

export function summarizeEvidence(results: GraderResult[]): EvidenceCounts {
  const counts: EvidenceCounts = {
    deterministic: { passed: 0, total: 0 },
    trace: { passed: 0, total: 0 },
    visual: { passed: 0, total: 0 },
    llm_judge: { passed: 0, total: 0 },
    manual: { passed: 0, total: 0 },
  };
  for (const result of results) {
    const tier = result.evidenceTier ?? evidenceTierForSpec(result.spec);
    counts[tier].total += 1;
    if (result.passed) counts[tier].passed += 1;
  }
  return counts;
}

export function evidenceTierForSpec(spec: GraderSpec): EvidenceTier {
  switch (spec.type) {
    case "step":
      return "trace";
    case "rubric_llm":
      return "llm_judge";
    case "manual":
      return "manual";
    default:
      return "deterministic";
  }
}

export function statusRatio(status: RunCaseRecord["status"]) {
  return status === "passed" ? 1 : status === "pending" || status === "running" || status === "grading" ? 0.5 : 0;
}

export function ratio(passed: number, total: number) {
  return total > 0 ? passed / total : 0;
}

export function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function confidenceGrade(score: number) {
  if (score >= 90) return "High confidence";
  if (score >= 75) return "Solid confidence";
  if (score >= 60) return "Needs review";
  return "Weak proof";
}
