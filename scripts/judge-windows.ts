/**
 * Standalone marker-window judge runner.
 *
 * The web process's "Judge all windows" job dies with dev-server restarts and
 * its status singleton resets on every HMR recompile. This script owns its own
 * loop, so long judging passes survive both; verdicts persist to
 * data/live-cache.db, which the Timeline page reads on refresh.
 *
 *   npm run judge:windows            # judge every unjudged window session (cap 500)
 *   npm run judge:windows -- --cap 50
 *
 * Judge selection follows the same env as the web app (JUDGE_HARNESS, or the
 * OpenRouter fallback via OPENROUTER_API_KEY).
 */
import { collectAllPoints } from "../lib/insights/collect";
import { judgeAllWindows } from "../lib/insights/judge";

async function main() {
  const capIdx = process.argv.indexOf("--cap");
  const capRaw = capIdx >= 0 ? Number(process.argv[capIdx + 1]) : NaN;
  const cap = Number.isFinite(capRaw) && capRaw >= 0 ? capRaw : 500;

  console.log("Collecting session points…");
  const { points, markers } = collectAllPoints();

  const res = await judgeAllWindows(points, markers, {
    cap,
    onProgress: ({ done, total, judged, failed }) => {
      process.stdout.write(`\rjudging ${done}/${total} — ${judged} ok, ${failed} failed   `);
    },
  });

  if (res.total === 0) {
    console.log("Nothing to judge — every marker-window session already has a verdict.");
    return;
  }
  console.log(`\ndone: ${res.judged}/${res.total} judged, ${res.failed} failed via ${res.judge}${res.lastError ? `\nlast error: ${res.lastError}` : ""}`);
  if (res.judged === 0 && res.failed > 0) process.exitCode = 1;
}

main();
