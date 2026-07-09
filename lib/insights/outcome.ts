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

const sat = (x: number) => Math.tanh(Math.max(0, x)); // diminishing returns, ≥0

export function scoreOutcome(session: LiveSession): OutcomeScore {
  const s = session.outcomeSignals;
  const reasons: Array<{ text: string; mag: number }> = [];
  let score = 0.5; // neutral prior
  let hasSignal = false;

  const add = (delta: number, text: string) => {
    if (delta === 0) return;
    score += delta;
    hasSignal = true;
    reasons.push({ text, mag: Math.abs(delta) });
  };

  add(+0.25 * sat(s.userPositive), `praise ×${s.userPositive}`);
  add(-0.30 * sat(s.userNegative), `correction/rejection ×${s.userNegative}`);
  add(-0.08 * sat(s.rephrases / 2), `rephrased ×${s.rephrases}`);
  add(s.errorTail ? -0.12 : 0, "ended on an error/apology");
  add(s.testsPassedTail ? +0.1 : 0, "verification passed at the end");
  add(-0.06 * sat(s.reworkFiles / 3), `${s.reworkFiles} file(s) rewritten`);
  const toolErr = session.toolErrorRate || 0;
  add(-0.1 * Math.min(1, toolErr * 2), `tool-error rate ${(toolErr * 100).toFixed(0)}%`);

  return {
    score: Math.max(0, Math.min(1, score)),
    provenance: "heuristic",
    reasons: reasons.sort((a, b) => b.mag - a.mag).map((r) => r.text),
    hasSignal,
  };
}
