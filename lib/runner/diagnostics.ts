/**
 * Make common authentication failures actionable without discarding the
 * original runner output. The raw diagnostic remains in the returned text so
 * a case report still contains the evidence needed for debugging.
 */
export function describeRunnerFailure(harness: string | undefined, diagnostic: string): string {
  const raw = diagnostic.trim().slice(0, 500);
  const normalized = raw.toLowerCase();

  if (
    harness === "claude-code" &&
    normalized.includes("401") &&
    (normalized.includes("oauth") || normalized.includes("access token")) &&
    (normalized.includes("revoked") || normalized.includes("expired") || normalized.includes("invalid"))
  ) {
    return `Claude Code authentication expired or was revoked. Open a terminal, run \`claude\`, then \`claude login\`, and retry this case.\n\nRunner diagnostic:\n${raw}`;
  }

  if (
    harness === "codex" &&
    (normalized.includes(".vibe-ads-orig") || normalized.includes("err_unknown_file_extension"))
  ) {
    return `Codex CLI could not start because its local wrapper installation is broken. Restore or reinstall Codex CLI, then refresh harnesses and retry this case.\n\nRunner diagnostic:\n${raw}`;
  }

  return `Runner error: ${raw}`;
}
