import type { DiscoveredHarness } from "./discover";

export type HarnessDiagnosticLevel = "error" | "warn";

export interface HarnessDiagnostic {
  level: HarnessDiagnosticLevel;
  title: string;
  message: string;
}

export interface HarnessSelection {
  effectiveId?: string;
  selected?: DiscoveredHarness;
  diagnostic: HarnessDiagnostic | null;
}

/**
 * Turn low-level CLI probe output into a short operator-facing explanation.
 * Keep the raw probe in the API response for the Harnesses page; this copy is
 * deliberately stable enough to use in launch validation and the picker.
 */
export function describeHarnessFailure(input: {
  id: string;
  status: "available" | "not_found" | "error";
  detail?: string;
}): HarnessDiagnostic {
  const detail = input.detail || "";
  const normalized = detail.toLowerCase();

  if (input.status === "not_found") {
    return {
      level: "error",
      title: "CLI not found",
      message: "Install the harness or fix its PATH entry before launching a run.",
    };
  }

  if (
    input.id === "codex" &&
    (normalized.includes(".vibe-ads-orig") || normalized.includes("err_unknown_file_extension") || normalized.includes("vibe-ads"))
  ) {
    return {
      level: "error",
      title: "Codex CLI cannot start",
      message: "OpenEval found the Codex command, but its local wrapper fails before the CLI starts. Restore or reinstall Codex CLI, then click Refresh harnesses.",
    };
  }

  if (normalized.includes("eacces") || normalized.includes("permission denied")) {
    return {
      level: "error",
      title: "CLI cannot execute",
      message: "The harness binary was found, but the probe was denied. Check its executable permission and PATH entry, then click Refresh harnesses.",
    };
  }

  if (normalized.includes("timed out") || normalized.includes("timeout") || normalized.includes("etimedout")) {
    return {
      level: "error",
      title: "CLI probe timed out",
      message: "The harness did not answer its version/help probe. Fix or replace the local CLI before launching a run.",
    };
  }

  return {
    level: "error",
    title: "Harness probe failed",
    message: "The CLI was found, but its version/help check failed. Fix the local CLI, then click Refresh harnesses before launching.",
  };
}

/** Resolve the actual adapter behind the launcher's explicit or default choice. */
export function describeHarnessSelection(input: {
  value?: string;
  defaultHarness?: string;
  harnesses: DiscoveredHarness[];
}): HarnessSelection {
  const effectiveId = (input.value || input.defaultHarness || "").trim() || undefined;
  if (!effectiveId) {
    return {
      effectiveId,
      diagnostic: {
        level: "error",
        title: "No default harness",
        message: "OpenEval could not resolve a default harness. Refresh harness discovery before launching.",
      },
    };
  }

  const selected = input.harnesses.find((h) => h.id === effectiveId);
  if (!selected) {
    return {
      effectiveId,
      diagnostic: {
        level: "error",
        title: "Harness is unavailable",
        message: `"${effectiveId}" is not present in the latest discovery result. Refresh harnesses before launching.`,
      },
    };
  }

  return {
    effectiveId,
    selected,
    diagnostic: selected.status === "available" ? null : describeHarnessFailure(selected),
  };
}
