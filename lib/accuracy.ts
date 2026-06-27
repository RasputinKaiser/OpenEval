import type { CaseDefinition, EvidenceTier, GraderSpec } from "./types";

export interface CaseAccuracyAudit {
  id: string;
  name: string;
  category: string;
  difficulty: string;
  hasOracle: boolean;
  hasKnownBad: boolean;
  hasBudget: boolean;
  hasVisualContract: boolean;
  requiresVisionInput: boolean;
  graderCount: number;
  tiers: Record<EvidenceTier, number>;
  weaknesses: string[];
}

export interface AccuracyAudit {
  totalCases: number;
  oracleCases: number;
  knownBadCases: number;
  visualCases: number;
  visionInputCases: number;
  deterministicOrTraceCases: number;
  weakCases: number;
  tierTotals: Record<EvidenceTier, number>;
  cases: CaseAccuracyAudit[];
}

const EMPTY_TIERS: Record<EvidenceTier, number> = {
  deterministic: 0,
  trace: 0,
  visual: 0,
  llm_judge: 0,
  manual: 0,
};

export function graderEvidenceTier(spec: GraderSpec): EvidenceTier {
  switch (spec.type) {
    case "exit_code":
    case "tests_pass":
    case "file_contains":
    case "file_exists":
    case "file_eq":
    case "regex_match":
    case "json_path":
    case "files_unchanged":
    case "file_deleted":
    case "git_diff_contains":
    case "checksum":
      return "deterministic";
    case "step":
      return "trace";
    case "rubric_llm":
      return "llm_judge";
    case "manual":
      return "manual";
    default:
      return "manual";
  }
}

export function evidenceLabel(tier: EvidenceTier): string {
  switch (tier) {
    case "deterministic": return "Deterministic";
    case "trace": return "Trace";
    case "visual": return "Visual";
    case "llm_judge": return "LLM judge";
    case "manual": return "Manual";
  }
}

export function auditCases(cases: CaseDefinition[]): AccuracyAudit {
  const rows = cases.map((c) => auditCase(c));
  const tierTotals = { ...EMPTY_TIERS };
  for (const row of rows) {
    for (const [tier, count] of Object.entries(row.tiers) as Array<[EvidenceTier, number]>) {
      tierTotals[tier] += count;
    }
  }
  return {
    totalCases: rows.length,
    oracleCases: rows.filter((r) => r.hasOracle).length,
    knownBadCases: rows.filter((r) => r.hasKnownBad).length,
    visualCases: rows.filter((r) => r.hasVisualContract).length,
    visionInputCases: rows.filter((r) => r.requiresVisionInput).length,
    deterministicOrTraceCases: rows.filter((r) => r.tiers.deterministic + r.tiers.trace > 0).length,
    weakCases: rows.filter((r) => r.weaknesses.length > 0).length,
    tierTotals,
    cases: rows,
  };
}

function auditCase(c: CaseDefinition): CaseAccuracyAudit {
  const tiers = { ...EMPTY_TIERS };
  for (const grader of c.graders) tiers[graderEvidenceTier(grader)]++;
  if (c.visual?.expected_artifacts?.length) tiers.visual++;

  const hasOracle = !!(c.oracle?.solve || c.oracle?.final_text);
  const hasKnownBad = !!c.oracle?.known_bad?.length;
  const hasDeterministic = tiers.deterministic + tiers.trace > 0;
  const weaknesses: string[] = [];

  if (!hasOracle) weaknesses.push("missing oracle solve script");
  if (!hasKnownBad) weaknesses.push("no known-bad rejection script");
  if (!hasDeterministic) weaknesses.push("no deterministic or trace grader");
  if (tiers.llm_judge > 0 && tiers.deterministic === 0) weaknesses.push("LLM judge without deterministic backstop");
  if (c.visual?.requires_vision_input && !c.visual.expected_artifacts?.length) weaknesses.push("vision-input task has no visual artifact contract");

  return {
    id: c.id,
    name: c.name,
    category: c.category,
    difficulty: c.difficulty ?? "untiered",
    hasOracle,
    hasKnownBad,
    hasBudget: !!c.budget,
    hasVisualContract: !!c.visual,
    requiresVisionInput: !!c.visual?.requires_vision_input,
    graderCount: c.graders.length,
    tiers,
    weaknesses,
  };
}
