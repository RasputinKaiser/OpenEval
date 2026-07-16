export interface CostPresentation {
  label: string;
  value: string;
  available: boolean;
}

export function presentRunnerCost(
  usage: { costUsd: number; costSource?: "measured" | "inferred" | "missing" },
  digits = 4,
): CostPresentation {
  if (usage.costSource === "measured") {
    return { label: "Cost", value: `$${usage.costUsd.toFixed(digits)}`, available: true };
  }
  if (usage.costSource === "inferred") {
    return { label: "Est. cost", value: `~$${usage.costUsd.toFixed(digits)}`, available: true };
  }
  return { label: "Cost", value: "missing", available: false };
}

export function presentSummaryCost(
  summary: {
    totalCostUsd: number;
    estimatedCostCases?: number;
    measuredCostCases?: number;
    missingCostCases?: number;
  },
  digits = 4,
): CostPresentation {
  const hasCoverageMetadata = summary.estimatedCostCases != null
    || summary.measuredCostCases != null
    || summary.missingCostCases != null;
  if (!hasCoverageMetadata && summary.totalCostUsd > 0) {
    return {
      label: "Unverified legacy cost",
      value: `$${summary.totalCostUsd.toFixed(digits)} (source unknown)`,
      available: true,
    };
  }
  const estimated = summary.estimatedCostCases ?? 0;
  const measured = summary.measuredCostCases ?? 0;
  const missing = summary.missingCostCases ?? 0;
  const available = estimated + measured > 0;
  if (!available) {
    return {
      label: "Total cost",
      value: missing > 0 ? `missing (${missing} ${missing === 1 ? "case" : "cases"})` : "missing",
      available: false,
    };
  }
  const inferred = estimated > 0;
  const prefix = inferred ? "~" : "";
  return {
    label: missing > 0 ? (inferred ? "Partial est. cost" : "Partial cost") : (inferred ? "Est. total cost" : "Total cost"),
    value: `${prefix}$${summary.totalCostUsd.toFixed(digits)}${missing > 0 ? ` + ${missing} missing` : ""}`,
    available: true,
  };
}
