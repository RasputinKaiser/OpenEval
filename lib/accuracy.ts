import fs from "node:fs";
import path from "node:path";
import { CASES_DIR } from "./config";
import type { CaseDefinition, EvidenceTier, GraderSpec } from "./types";

/**
 * Options for filesystem-aware audit checks. Injectable so unit tests can point
 * at a synthetic corpus / resolver without touching the real cases directory.
 */
export interface AuditOptions {
  /** Directory that oracle script paths (`oracle/foo.sh`) resolve against, per category. Defaults to {@link CASES_DIR}. */
  casesDir?: string;
  /** Existence predicate for a resolved absolute path. Defaults to {@link fs.existsSync}. */
  fileExists?: (absPath: string) => boolean;
}

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

/**
 * True when a do-nothing ("no-op") agent — empty final text, no file changes,
 * no tool calls — would still PASS this grader. Such graders provide no signal
 * that the agent actually solved the task; a case whose deterministic graders
 * are all no-op-passing can score high on an empty run unless `noop_max_score`
 * catches it during selftest.
 */
function noopPassesGrader(spec: GraderSpec): boolean {
  switch (spec.type) {
    case "files_unchanged":
      return true;
    case "file_exists":
    case "file_contains":
    case "regex_match":
    case "git_diff_contains":
    case "step":
      return spec.negate === true;
    default:
      return false;
  }
}

export function auditCases(cases: CaseDefinition[], opts?: AuditOptions): AccuracyAudit {
  const rows = cases.map((c) => auditCase(c, opts));
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

export function auditCase(c: CaseDefinition, opts?: AuditOptions): CaseAccuracyAudit {
  const casesDir = opts?.casesDir ?? CASES_DIR;
  const fileExists = opts?.fileExists ?? fs.existsSync;

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

  // Oracle-file existence: `solve` / `known_bad` are script paths resolved as
  // <casesDir>/<category>/<path> (mirrors selftest.ts). A declared-but-missing
  // script silently disables selftest coverage, so flag it as a real weakness.
  const oracleScripts: string[] = [];
  if (c.oracle?.solve) oracleScripts.push(c.oracle.solve);
  for (const kb of c.oracle?.known_bad ?? []) oracleScripts.push(kb);
  for (const rel of oracleScripts) {
    const abs = path.join(casesDir, c.category, rel);
    if (!fileExists(abs)) weaknesses.push(`oracle script missing on disk: ${rel}`);
  }

  // No-op baseline: if every deterministic grader passes on a do-nothing run and
  // there is no `noop_max_score` guard, an empty submission could score high and
  // go undetected. Reported (not a hard failure).
  const deterministicGraders = c.graders.filter((g) => graderEvidenceTier(g) === "deterministic");
  const hasNoopGuard = typeof c.oracle?.noop_max_score === "number";
  if (deterministicGraders.length > 0 && deterministicGraders.every(noopPassesGrader) && !hasNoopGuard) {
    weaknesses.push("deterministic graders all pass on a no-op run; no oracle.noop_max_score guard");
  }

  // Weak backstop: an LLM-judge case satisfies "has a deterministic backstop"
  // (rule above) even if that backstop is only broad regex_match graders, which
  // can rubber-stamp any output. Flag when regex_match is the sole deterministic
  // teeth behind a rubric_llm grader.
  if (
    tiers.llm_judge > 0 &&
    deterministicGraders.length > 0 &&
    deterministicGraders.every((g) => g.type === "regex_match")
  ) {
    weaknesses.push("rubric_llm backstop is only regex_match graders (weak deterministic teeth)");
  }

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
