import type { LiveSession } from "../live";

/**
 * A transparent, bounded 0..1 heuristic "did this session go well?" score from
 * the inferred outcome signals. This is a PROXY, not a verdict — the weights are
 * visible and the reasons are surfaced so a number is never a black box. Your
 * own reactions (praise / correction) dominate; struggle and rework pull down.
 */
export interface OutcomeScore {
  score: number;
  provenance: "heuristic" | "judged";
  /** Human-readable contributors, most impactful first. */
  reasons: string[];
  /** Whether any signal actually fired (else the neutral prior is uninformative). */
  hasSignal: boolean;
}

const finiteNonNegative = (value: unknown): number => {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.max(0, n);
};

const finiteRate = (value: unknown): number => {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.min(1, Math.max(0, n));
};

const sat = (x: number) => Math.tanh(Math.max(0, x)); // diminishing returns, ≥0

export function scoreOutcome(session: LiveSession): OutcomeScore {
  const s = session.outcomeSignals ?? {
    userPositive: 0,
    userNegative: 0,
    rephrases: 0,
    errorTail: false,
    testsPassedTail: false,
    reworkFiles: 0,
  };
  const reasons: Array<{ text: string; mag: number; order: number }> = [];
  let score = 0.5; // neutral prior
  let hasSignal = false;
  let order = 0;

  const add = (delta: number, text: string) => {
    if (!Number.isFinite(delta) || delta === 0) return;
    score += delta;
    hasSignal = true;
    reasons.push({ text, mag: Math.abs(delta), order: order++ });
  };

  const userPositive = finiteNonNegative(s.userPositive);
  const userNegative = finiteNonNegative(s.userNegative);
  const rephrases = finiteNonNegative(s.rephrases);
  const reworkFiles = finiteNonNegative(s.reworkFiles);
  add(+0.25 * sat(userPositive), `praise ×${userPositive}`);
  add(-0.30 * sat(userNegative), `correction/rejection ×${userNegative}`);
  add(-0.08 * sat(rephrases / 2), `rephrased ×${rephrases}`);
  add(s.errorTail ? -0.12 : 0, "ended on an error/apology");
  add(s.testsPassedTail ? +0.1 : 0, "verification passed at the end");
  add(-0.06 * sat(reworkFiles / 3), `${reworkFiles} file(s) rewritten`);
  const toolErr = finiteRate(session.toolErrorRate);
  add(-0.1 * Math.min(1, toolErr * 2), `tool-error rate ${(toolErr * 100).toFixed(0)}%`);

  return {
    score: Math.max(0, Math.min(1, score)),
    provenance: "heuristic",
    reasons: reasons.sort((a, b) => b.mag - a.mag || a.order - b.order).map((r) => r.text),
    hasSignal,
  };
}
