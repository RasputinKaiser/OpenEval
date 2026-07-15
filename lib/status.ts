import type { RunCaseRecord } from "./types";

export const TERMINAL_CASE_STATUSES = ["passed", "failed", "error", "skipped"] as const;

export function isTerminalCaseStatus(status: string | undefined | null): status is RunCaseRecord["status"] {
  return !!status && (TERMINAL_CASE_STATUSES as readonly string[]).includes(status);
}
