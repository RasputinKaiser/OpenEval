/**
 * Pure logic for the dashboard first-run guided path and onboarding overlay.
 * Kept free of React imports so node:test can exercise it directly.
 */

/** localStorage key persisting overlay dismissal. Changing it would re-show the tour for everyone. */
export const ONBOARDING_DISMISSED_KEY = "openeval-onboarding-dismissed";
/** Window event Settings dispatches to re-open the welcome tour. */
export const SHOW_ONBOARDING_EVENT = "openeval-show-onboarding";

export type Probe<T> =
  | { phase: "checking" }
  | { phase: "unavailable" }
  | { phase: "ready"; data: T };

export interface HarnessProbe {
  /** Harnesses whose CLI probe succeeded. */
  available: string[];
  /** All known harness ids, whatever their status. */
  total: number;
}

export interface SessionProbe {
  /** Sessions from parseable sources only — the ones Live/Collection can actually surface. */
  totalKnownSessions: number;
  /** Present parseable sources. */
  presentSources: number;
  /** Sessions found in detect-only (parseable: false) sources, e.g. Cursor or Cline. */
  detectOnlySessions: number;
}

export interface RunProbe {
  runCount: number;
}

export type GuideStepStatus = "checking" | "done" | "todo" | "unavailable";

export interface GuideStep {
  key: "harnesses" | "sessions" | "run";
  title: string;
  description: string;
  href: string;
  linkLabel: string;
  status: GuideStepStatus;
  detail: string;
}

function probeStatus(done: boolean, phase: "checking" | "unavailable" | "ready"): GuideStepStatus {
  if (phase === "checking") return "checking";
  if (phase === "unavailable") return "unavailable";
  return done ? "done" : "todo";
}

/**
 * Derive the three guided-path steps from live detection probes. Failed probes
 * surface as "unavailable" — never as a fake "nothing detected".
 */
export function buildGuideSteps(
  harness: Probe<HarnessProbe>,
  sessions: Probe<SessionProbe>,
  runs: Probe<RunProbe>,
): GuideStep[] {
  const harnessDone = harness.phase === "ready" && harness.data.available.length > 0;
  const sessionsDone = sessions.phase === "ready" && sessions.data.totalKnownSessions > 0;
  const runsDone = runs.phase === "ready" && runs.data.runCount > 0;

  const harnessDetail =
    harness.phase === "checking" ? "Probing PATH for agent CLIs…"
    : harness.phase === "unavailable" ? "Detection status unavailable — could not reach the server."
    : harnessDone
      ? `${harness.data.available.length} of ${harness.data.total} known ${harness.data.total === 1 ? "harness" : "harnesses"} available: ${harness.data.available.join(", ")}`
      : "No agent CLIs found on PATH. Install one (ncode, Claude Code, or Codex), then re-check.";

  const sessionsDetail =
    sessions.phase === "checking" ? "Scanning this machine for existing transcripts…"
    : sessions.phase === "unavailable" ? "Detection status unavailable — could not reach the server."
    : sessionsDone
      ? `${sessions.data.totalKnownSessions.toLocaleString()} past ${sessions.data.totalKnownSessions === 1 ? "session" : "sessions"} found across ${sessions.data.presentSources} ${sessions.data.presentSources === 1 ? "source" : "sources"} — insights are ready before your first eval.`
      : sessions.data.detectOnlySessions > 0
        ? `${sessions.data.detectOnlySessions.toLocaleString()} ${sessions.data.detectOnlySessions === 1 ? "session" : "sessions"} detected in sources OpenEval can't parse for metrics yet. Parseable transcripts appear after a supported harness runs once.`
        : "No transcripts yet. They appear here automatically after any harness runs once.";

  const runsDetail =
    runs.phase === "checking" ? "Checking for recorded runs…"
    : runs.phase === "unavailable" ? "Detection status unavailable — could not reach the server."
    : runsDone
      ? `${runs.data.runCount} eval ${runs.data.runCount === 1 ? "run" : "runs"} recorded.`
      : "Pick cases and a harness, then launch. Results stream in live.";

  return [
    {
      key: "harnesses",
      title: "Detect your agent CLIs",
      description: "OpenEval benchmarks any agent CLI on this machine — ncode, Claude Code, Codex, or your own descriptor-driven harness.",
      href: "/harnesses",
      linkLabel: "View harnesses",
      status: probeStatus(harnessDone, harness.phase),
      detail: harnessDetail,
    },
    {
      key: "sessions",
      title: "See what already ran here",
      description: "Live and Collection read the transcripts your harnesses have already written — no eval required.",
      href: "/live",
      linkLabel: "Open Live sessions",
      status: probeStatus(sessionsDone, sessions.phase),
      detail: sessionsDetail,
    },
    {
      key: "run",
      title: "Launch your first eval run",
      description: "Run graded cases against a detected harness and watch pass rates, tokens, and cost stream in.",
      href: "/runs/new",
      linkLabel: "Start a run",
      status: probeStatus(runsDone, runs.phase),
      detail: runsDetail,
    },
  ];
}
