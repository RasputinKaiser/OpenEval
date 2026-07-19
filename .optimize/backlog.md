# Backlog

| # | area | fix | evidence | impact | confidence | effort | score |
|---|------|-----|----------|--------|------------|--------|-------|
| 1 | runtime | end-to-end scanSourceSessions timing (directory walk + cache-hit path + SQLite round-trip) — the parser is optimized, the scan pipeline around it is unmeasured | run-3 profile: parse near JSON.parse floor; live-cache warm path unbenched | /live + /collection load time | 0.6 | 1.5h | high |
| 2 | devloop | measure warm `next build` on an idle machine (43.9s cold run 1; 52.5s run 2 was load-poisoned) | run-2 noise flag in ledger | unknown until measured | 0.9 | 10m | mid |
| 3 | runtime | prefix-sniff to skip JSON.parse on ignored record types — ONLY behind scripts/perf equiv net + real-transcript hashes | run-3 profile: JSON.parse ≈64% of remaining parse cost | up to ~30% more cold-scan | 0.4 | 3h | mid |
| 4 | agent | update openeval-dev-loop skill verify one-liner (`grep "^# (pass|fail)"` dead since dot reporter) — needs owner, skill lives outside repo | run-3 consequence note | avoids false "no tests ran" reads | 0.9 | 5m | note |
| 5 | health | eslint 8.57.1 EOL; eslint 9 is a major bump — out of scope for /optimize, flag to owner | npm ci deprecation warnings | n/a | 0.9 | — | note |
| 6 | runtime | downsampleUsageSegments one-pass block aggregation (skipped in run 3: boundary-carry equivalence risk vs ~40ms) | run-3 analysis findings | ~40ms/32MB scan | 0.5 | 1h | low |

Done (for grep): run-1 #1 bench harness → 6c8be58; run-1 #4 runs/ .ignore → 86c6e9d;
run-2 #1 parser optimization → b014e9b (+harness ff78a27); run-2 #2 test-child
overhead → closed not-worth-it (run-3 ledger); run-2 #5 load-guard → superseded by
in-process ab-compare.ts method note (run-3 ledger).
