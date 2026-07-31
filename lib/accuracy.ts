import type { CaseDefinition, EvidenceTier, GraderSpec } from "./types";

export const ACCURACY_SURFACES = ["tests", "oracle", "known_bad", "trace", "visual", "judge", "manual"] as const;
export type AccuracySurface = (typeof ACCURACY_SURFACES)[number];
export type AccuracyStatus = "pass" | "fail" | "unknown" | "not_applicable";

export interface CaseEvidence {
  status: AccuracyStatus;
  /** Declarations found in the case definition. This is not a runtime verdict. */
  declaredEvidence: number;
  /** Evidence that this audit can verify without running the case. */
  verifiedEvidence: number;
  detail: string;
}

export interface AccuracySurfaceAudit {
  status: AccuracyStatus;
  applicableCases: number;
  passingCases: number;
  failingCases: number;
  unknownCases: number;
  notApplicableCases: number;
  declaredEvidence: number;
  verifiedEvidence: number;
  summary: string;
}

export interface CorpusAudit {
  status: AccuracyStatus;
  validCases: number;
  invalidFiles: number;
  issues: string[];
  summary: string;
}

/**
 * Options for filesystem-aware audit checks. Injectable so unit tests can point
 * at a synthetic corpus / resolver without touching the real cases directory.
 */
export interface AuditOptions {
  /** Directory that oracle script paths (`oracle/foo.sh`) resolve against, per category. Server callers pass CASES_DIR. */
  casesDir?: string;
  /** Existence predicate for a resolved absolute path (e.g. `fs.existsSync`). When omitted (or `casesDir` omitted), the on-disk oracle-script check is skipped — this keeps `lib/accuracy.ts` free of `node:fs` so client components can import it. */
  fileExists?: (absPath: string) => boolean;
  /** Relative case-loader issues. Omit when the caller cannot establish corpus completeness. */
  corpusErrors?: string[];
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
  deterministicCount: number;
  traceCount: number;
  visualArtifactCount: number;
  judgeCount: number;
  manualCount: number;
  oracleScriptsDeclared: number;
  oracleScriptsVerified: number;
  knownBadScriptsDeclared: number;
  knownBadScriptsVerified: number;
  evidence: Record<AccuracySurface, CaseEvidence>;
  weaknesses: string[];
  uncertainties: string[];
}

export interface AccuracyAudit {
  totalCases: number;
  oracleCases: number;
  knownBadCases: number;
  visualCases: number;
  visionInputCases: number;
  deterministicOrTraceCases: number;
  weakCases: number;
  failedCases: number;
  unknownCases: number;
  tierTotals: Record<EvidenceTier, number>;
  status: AccuracyStatus;
  corpus: CorpusAudit;
  surfaces: Record<AccuracySurface, AccuracySurfaceAudit>;
  cases: CaseAccuracyAudit[];
}

export function hasStrictAccuracyFailure(row: CaseAccuracyAudit): boolean {
  return (
    !row.hasOracle ||
    row.tiers.deterministic + row.tiers.trace === 0 ||
    row.weaknesses.some((weakness) =>
      weakness.startsWith("oracle script missing on disk:") || weakness.startsWith("oracle script path escapes"),
    )
  );
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
    case "render_evidence":
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

export function accuracyStatusLabel(status: AccuracyStatus): string {
  switch (status) {
    case "pass": return "Pass";
    case "fail": return "Fail";
    case "unknown": return "Unknown";
    case "not_applicable": return "N/A";
  }
}

export function accuracySurfaceLabel(surface: AccuracySurface): string {
  switch (surface) {
    case "tests": return "Deterministic tests";
    case "oracle": return "Oracle solve";
    case "known_bad": return "Known-bad rejection";
    case "trace": return "Trace steps";
    case "visual": return "Visual contract";
    case "judge": return "LLM judge";
    case "manual": return "Manual review";
  }
}

function makeEvidence(
  status: AccuracyStatus,
  declaredEvidence: number,
  verifiedEvidence: number,
  detail: string,
): CaseEvidence {
  return { status, declaredEvidence, verifiedEvidence, detail };
}

function safeScriptRef(ref: string): string {
  const normalized = ref.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").includes("..")) {
    return "[path redacted]";
  }
  return normalized;
}

/**
 * Keep the injected filesystem predicate inside the category directory. This
 * also keeps malicious or accidental absolute oracle references out of the
 * displayed audit details.
 */
function resolveScriptCandidate(base: string, ref: string): string | null {
  const normalized = ref.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return null;
  const parts = normalized.split("/");
  if (parts.includes("..")) return null;
  return `${base}/${parts.filter(Boolean).join("/")}`;
}

function statusForSurface(rows: CaseAccuracyAudit[], surface: AccuracySurface): AccuracySurfaceAudit {
  const checks = rows.map((row) => row.evidence[surface]);
  const passingCases = checks.filter((check) => check.status === "pass").length;
  const failingCases = checks.filter((check) => check.status === "fail").length;
  const unknownCases = checks.filter((check) => check.status === "unknown").length;
  const notApplicableCases = checks.filter((check) => check.status === "not_applicable").length;
  const applicableCases = rows.length - notApplicableCases;
  const status: AccuracyStatus = failingCases > 0
    ? "fail"
    : unknownCases > 0
      ? "unknown"
      : passingCases > 0
        ? "pass"
        : "not_applicable";
  const declaredEvidence = checks.reduce((sum, check) => sum + check.declaredEvidence, 0);
  const verifiedEvidence = checks.reduce((sum, check) => sum + check.verifiedEvidence, 0);
  let summary: string;
  if (surface === "visual" && unknownCases > 0) {
    summary = `${declaredEvidence} artifact contract${declaredEvidence === 1 ? "" : "s"} declared; rendered output is not attached to this metadata audit`;
  } else if (surface === "judge" && unknownCases > 0) {
    summary = `${declaredEvidence} judge contract${declaredEvidence === 1 ? "" : "s"} declared; no runtime verdict is attached`;
  } else if (surface === "manual" && unknownCases > 0) {
    summary = `${unknownCases} case${unknownCases === 1 ? "" : "s"} require human review`;
  } else {
    summary = `${passingCases}/${applicableCases} applicable cases pass this surface`;
  }
  return {
    status,
    applicableCases,
    passingCases,
    failingCases,
    unknownCases,
    notApplicableCases,
    declaredEvidence,
    verifiedEvidence,
    summary,
  };
}

function aggregateStatus(corpus: CorpusAudit, surfaces: Record<AccuracySurface, AccuracySurfaceAudit>): AccuracyStatus {
  const statuses = Object.values(surfaces).map((surface) => surface.status);
  if (corpus.status === "fail" || statuses.includes("fail")) return "fail";
  if (corpus.status === "unknown" || statuses.includes("unknown")) return "unknown";
  if (corpus.status === "pass" || statuses.includes("pass")) return "pass";
  return "not_applicable";
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
  const corpusKnown = opts !== undefined && Object.prototype.hasOwnProperty.call(opts, "corpusErrors");
  const corpusIssues = [...(opts?.corpusErrors ?? [])];
  const corpus: CorpusAudit = {
    status: !corpusKnown ? "unknown" : corpusIssues.length > 0 ? "fail" : "pass",
    validCases: rows.length,
    invalidFiles: corpusIssues.length,
    issues: corpusIssues,
    summary: !corpusKnown
      ? "Case-loader completeness was not supplied"
      : corpusIssues.length > 0
        ? `${rows.length} valid case${rows.length === 1 ? "" : "s"}; ${corpusIssues.length} loader issue${corpusIssues.length === 1 ? "" : "s"}`
        : `${rows.length} valid case${rows.length === 1 ? "" : "s"}; no loader issues reported`,
  };
  const surfaces = Object.fromEntries(
    ACCURACY_SURFACES.map((surface) => [surface, statusForSurface(rows, surface)]),
  ) as Record<AccuracySurface, AccuracySurfaceAudit>;
  const failedCases = rows.filter((row) => Object.values(row.evidence).some((check) => check.status === "fail")).length;
  const unknownCases = rows.filter((row) => Object.values(row.evidence).some((check) => check.status === "unknown")).length;
  const status = aggregateStatus(corpus, surfaces);
  return {
    totalCases: rows.length,
    oracleCases: rows.filter((r) => r.hasOracle).length,
    knownBadCases: rows.filter((r) => r.hasKnownBad).length,
    visualCases: rows.filter((r) => r.hasVisualContract).length,
    visionInputCases: rows.filter((r) => r.requiresVisionInput).length,
    deterministicOrTraceCases: rows.filter((r) => r.tiers.deterministic + r.tiers.trace > 0).length,
    weakCases: rows.filter((r) => r.weaknesses.length > 0).length,
    failedCases,
    unknownCases,
    tierTotals,
    status,
    corpus,
    surfaces,
    cases: rows,
  };
}

export function auditCase(c: CaseDefinition, opts?: AuditOptions): CaseAccuracyAudit {
  const casesDir = opts?.casesDir;
  const fileExists = opts?.fileExists;

  const tiers = { ...EMPTY_TIERS };
  for (const grader of c.graders) tiers[graderEvidenceTier(grader)]++;
  if (c.visual?.expected_artifacts?.length) tiers.visual++;

  const hasOracle = !!(c.oracle?.solve || c.oracle?.final_text);
  const hasKnownBad = !!c.oracle?.known_bad?.length;
  const hasDeterministic = tiers.deterministic + tiers.trace > 0;
  const weaknesses: string[] = [];
  const uncertainties: string[] = [];
  const deterministicGraders = c.graders.filter((g) => graderEvidenceTier(g) === "deterministic");
  const traceCount = tiers.trace;
  const visualArtifactCount = c.visual?.expected_artifacts?.length ?? 0;
  const judgeCount = tiers.llm_judge;
  const manualCount = tiers.manual;
  const oracleScriptRefs = c.oracle?.solve ? [c.oracle.solve] : [];
  const knownBadScriptRefs = c.oracle?.known_bad ?? [];
  let oracleScriptsVerified = 0;
  let knownBadScriptsVerified = 0;
  let oracleScriptFailure = false;
  let knownBadScriptFailure = false;
  let oracleScriptUnknown = false;

  if (!hasOracle) weaknesses.push("missing oracle solve script");
  if (!hasKnownBad) weaknesses.push("no known-bad rejection script");
  if (!hasDeterministic) weaknesses.push("no deterministic or trace grader");
  if (tiers.llm_judge > 0 && tiers.deterministic === 0) weaknesses.push("LLM judge without deterministic backstop");
  if (c.visual?.requires_vision_input && !c.visual.expected_artifacts?.length) weaknesses.push("vision-input task has no visual artifact contract");

  // Oracle-file existence: `solve` / `known_bad` are script paths resolved as
  // <casesDir>/<category>/<path> (mirrors selftest.ts). A declared-but-missing
  // script silently disables selftest coverage, so flag it as a real weakness.
  // Only runs when a caller injects a filesystem predicate + casesDir — this
  // module must stay free of node:fs/node:path so client components can import
  // evidenceLabel/types without poisoning the browser bundle.
  if (fileExists) {
    const base = casesDir !== undefined ? `${casesDir}/${c.category}` : c.category;
    for (const rel of oracleScriptRefs) {
      const candidate = resolveScriptCandidate(base, rel);
      if (!candidate) {
        oracleScriptFailure = true;
        weaknesses.push(`oracle script path escapes case directory: ${safeScriptRef(rel)}`);
      } else if (fileExists(candidate)) {
        oracleScriptsVerified++;
      } else {
        oracleScriptFailure = true;
        weaknesses.push(`oracle script missing on disk: ${safeScriptRef(rel)}`);
      }
    }
    for (const rel of knownBadScriptRefs) {
      const candidate = resolveScriptCandidate(base, rel);
      if (!candidate) {
        knownBadScriptFailure = true;
        weaknesses.push(`oracle script path escapes case directory: ${safeScriptRef(rel)}`);
      } else if (fileExists(candidate)) {
        knownBadScriptsVerified++;
      } else {
        knownBadScriptFailure = true;
        weaknesses.push(`oracle script missing on disk: ${safeScriptRef(rel)}`);
      }
    }
  } else {
    oracleScriptUnknown = oracleScriptRefs.length > 0 || knownBadScriptRefs.length > 0;
    if (oracleScriptUnknown) uncertainties.push("oracle script declarations are present but disk resolution was not provided");
  }

  // No-op baseline: if every deterministic grader passes on a do-nothing run and
  // there is no `noop_max_score` guard, an empty submission could score high and
  // go undetected. Reported (not a hard failure).
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

  const oracleStatus: AccuracyStatus = !hasOracle
    ? "fail"
    : oracleScriptFailure
      ? "fail"
      : oracleScriptUnknown
        ? "unknown"
        : "pass";
  const knownBadStatus: AccuracyStatus = !hasKnownBad
    ? "fail"
    : knownBadScriptFailure
      ? "fail"
      : oracleScriptUnknown && knownBadScriptRefs.length > 0
        ? "unknown"
        : "pass";
  const testsStatus: AccuracyStatus = tiers.deterministic > 0 ? "pass" : "fail";
  // A step grader is a declared trace contract, not a runtime proof by itself.
  // The static audit cannot see the provider transcript or establish ordering,
  // so keep this surface Unknown until a bounded trace receipt is attached.
  const traceStatus: AccuracyStatus = traceCount > 0 ? "unknown" : "not_applicable";
  let visualStatus: AccuracyStatus = "not_applicable";
  if (c.visual) {
    if (visualArtifactCount === 0 || (c.visual.requires_vision_input && !(c.visual.input_images?.length))) {
      visualStatus = "fail";
      if (visualArtifactCount === 0) weaknesses.push("visual case has no expected artifact contract");
      if (c.visual.requires_vision_input && !(c.visual.input_images?.length)) weaknesses.push("vision-input task has no input image contract");
    } else {
      visualStatus = "unknown";
      uncertainties.push("visual artifact contract is declared but no rendered artifact is attached to this audit");
    }
  }
  let judgeStatus: AccuracyStatus = "not_applicable";
  if (judgeCount > 0) {
    const hasStrongBackstop = deterministicGraders.some((grader) => grader.type !== "regex_match");
    if (!hasStrongBackstop) judgeStatus = "fail";
    else {
      judgeStatus = "unknown";
      uncertainties.push("LLM judge contract is declared but no runtime judge verdict is attached to this audit");
    }
  }
  const manualStatus: AccuracyStatus = manualCount > 0 ? "unknown" : "not_applicable";
  if (manualStatus === "unknown") uncertainties.push("manual grader requires human review");

  const evidence: Record<AccuracySurface, CaseEvidence> = {
    tests: makeEvidence(testsStatus, tiers.deterministic, tiers.deterministic, `${tiers.deterministic} deterministic grader${tiers.deterministic === 1 ? "" : "s"}`),
    oracle: makeEvidence(
      oracleStatus,
      hasOracle ? 1 : 0,
      oracleStatus === "pass" ? 1 : 0,
      hasOracle ? (c.oracle?.final_text ? "final answer oracle declared" : "solve script declared") : "no solve script or final answer oracle",
    ),
    known_bad: makeEvidence(
      knownBadStatus,
      knownBadScriptRefs.length,
      knownBadStatus === "pass" ? knownBadScriptRefs.length : 0,
      hasKnownBad ? `${knownBadScriptRefs.length} plausible-but-wrong rejection script${knownBadScriptRefs.length === 1 ? "" : "s"}` : "no known-bad rejection script",
    ),
    trace: makeEvidence(
      traceStatus,
      traceCount,
      0,
      traceCount > 0
        ? `${traceCount} trace-step grader${traceCount === 1 ? "" : "s"} declared; runtime transcript evidence is not attached`
        : "no trace-step grader",
    ),
    visual: makeEvidence(
      visualStatus,
      visualArtifactCount,
      0,
      c.visual ? `${visualArtifactCount} expected visual artifact${visualArtifactCount === 1 ? "" : "s"} declared` : "no visual contract",
    ),
    judge: makeEvidence(
      judgeStatus,
      judgeCount,
      0,
      judgeCount > 0 ? `${judgeCount} rubric judge${judgeCount === 1 ? "" : "s"} declared` : "no LLM judge",
    ),
    manual: makeEvidence(
      manualStatus,
      manualCount,
      0,
      manualCount > 0 ? `${manualCount} manual review${manualCount === 1 ? "" : "s"} required` : "no manual grader",
    ),
  };

  return {
    id: c.id,
    name: c.name,
    category: c.category,
    difficulty: c.difficulty ?? "untiered",
    hasOracle,
    hasKnownBad,
    hasBudget: !!c.budget,
    hasVisualContract: !!c.visual?.expected_artifacts?.length,
    requiresVisionInput: !!c.visual?.requires_vision_input,
    graderCount: c.graders.length,
    tiers,
    deterministicCount: tiers.deterministic,
    traceCount,
    visualArtifactCount,
    judgeCount,
    manualCount,
    oracleScriptsDeclared: oracleScriptRefs.length,
    oracleScriptsVerified,
    knownBadScriptsDeclared: knownBadScriptRefs.length,
    knownBadScriptsVerified,
    evidence,
    weaknesses,
    uncertainties,
  };
}
