# OpenEval optimization ledger

Conventions: exchange rate 10k wasted tokens ≈ 60s. Estimator recorded per run.
Probes: see probes.sh. Never run the `build` probe while a dev server serves the
same checkout (openeval-dev-loop skill).

## Run 1 — 2026-07-18 (full, ca1383b, clean tree, estimator heuristic-chars/4, 10k tok ≈ 60s)
Baseline (fresh worktree, cold caches): types 19.7s (warm re-run: 9.3s), test 9.7s,
lint 7.7s, build 43.9s. Tokens: surfaces 1.5k, repo 385.5k, probes 14.9k,
refetch waste 104.9k over 10 sessions (snapshot of primary + 2 worktree slugs).
- Applied: optimize: terse node:test reporter (04ae8eb) | npm test output 13,996 → 75 tokens (−99.5%); time 9.68s → 10.79s median, inside baseline sample spread 9.3–12.1s; failure details verified intact via forced failure. Information removed: per-test "ok" TAP lines on green runs — none.
- Applied: optimize: .ignore for package-lock.json (502abb9) | rg file set 290 → 289 (lockfile out); representative repo-wide grep ("next") −2.8KB (−17%). NOTE: tokens.py `unignored_noise` tracks gitignore only, so its 67k figure will NOT move — do not re-attempt this fix based on that number.
- Applied: optimize: CLAUDE.md symlink → NCODE.md (23d49c0) | 6/10 recent sessions manually located NCODE.md (~1.7k tok/read + discovery); now auto-loaded. All NCODE.md commands executed green this run.
- Not fixable here: refetch waste is 90% byte-identical preview_screenshot retakes (browser-pane stale-frame quirk, already documented in user gotchas) — no repo-side fix.
- Tokens caveat: repo_tokens rose 385.5k → 397.9k during the run — self-inflation from .optimize/runs/*.json artifacts, not a regression.
- Backlog: top 3 below.
- Next run: worktree bootstrap costs ~45s npm ci + cold caches — expect types ~9.3s warm, not 19.7s. Start at backlog #1 (runtime benchmark harness for lib/live.ts scan). Probes are trusted. Session-token comparisons must reuse the same 10-transcript snapshot set or skip the claim.
