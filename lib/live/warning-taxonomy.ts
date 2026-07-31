export interface ParseWarningCounts {
  sessionsWithWarnings: number;
  missingEvidence: number;
  inferredEvidence: number;
  incompleteTrace: number;
  malformedInput: number;
  runtimeErrors: number;
  mixedModels: number;
  other: number;
}

export type ActionableParseWarningCategory = Exclude<keyof ParseWarningCounts, "sessionsWithWarnings">;
export type ParseWarningCategory = ActionableParseWarningCategory | "metadata";

export function emptyParseWarningCounts(): ParseWarningCounts {
  return {
    sessionsWithWarnings: 0,
    missingEvidence: 0,
    inferredEvidence: 0,
    incompleteTrace: 0,
    malformedInput: 0,
    runtimeErrors: 0,
    mixedModels: 0,
    other: 0,
  };
}

export function classifyParseWarning(warning: string): ParseWarningCategory {
  const normalized = warning.trim().toLowerCase();
  if (normalized.startsWith("source:")) return "metadata";
  if (normalized.includes("missing from trace")) return "missingEvidence";
  if (normalized.includes("inferred")) return "inferredEvidence";
  if (normalized.includes("no final result event")) return "incompleteTrace";
  if (normalized.includes("malformed line")) return "malformedInput";
  if (normalized.includes("hook error")) return "runtimeErrors";
  if (normalized.startsWith("mixed models:")) return "mixedModels";
  return "other";
}

/**
 * Add one session to an aggregate. A category is counted at most once per
 * session even if multiple warning strings describe the same evidence gap.
 * Source metadata is intentionally not treated as a warning.
 */
export function countSessionWarnings(counts: ParseWarningCounts, warnings: readonly string[]): void {
  const categories = new Set<ActionableParseWarningCategory>();
  for (const warning of warnings) {
    const category = classifyParseWarning(warning);
    if (category !== "metadata") categories.add(category);
  }
  if (categories.size === 0) return;
  counts.sessionsWithWarnings += 1;
  for (const category of categories) counts[category] += 1;
}

export function mergeParseWarningCounts(counts: readonly ParseWarningCounts[]): ParseWarningCounts {
  const merged = emptyParseWarningCounts();
  for (const entry of counts) {
    merged.sessionsWithWarnings += entry.sessionsWithWarnings;
    merged.missingEvidence += entry.missingEvidence;
    merged.inferredEvidence += entry.inferredEvidence;
    merged.incompleteTrace += entry.incompleteTrace;
    merged.malformedInput += entry.malformedInput;
    merged.runtimeErrors += entry.runtimeErrors;
    merged.mixedModels += entry.mixedModels;
    merged.other += entry.other;
  }
  return merged;
}
