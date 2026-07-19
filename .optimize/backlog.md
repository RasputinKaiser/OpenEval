# Backlog

| # | area | fix | evidence | impact | confidence | effort | score |
|---|------|-----|----------|--------|------------|--------|-------|
| 1 | runtime | profile parseLiveSession and close the 30% throughput gap vs codex parser (71.8 vs 105.0 MB/s, run-2 bench) | .optimize/runs/20260718T-run2-bench.json | scan-time on every /live and /collection load | 0.6 | 2h | high |
| 2 | devloop | test suite child-process overhead: 28 files × tsx import under node --test; try shared compile cache or fewer processes | probe: test 9.7–12.7s median for ~110 fast tests | ~5s/run × many runs/wk | 0.6 | 1h | mid |
| 3 | devloop | measure warm `next build` on an idle machine (43.9s cold run 1; 52.5s run 2 was load-poisoned) | run-2 noise flag in ledger | unknown until measured | 0.9 | 10m | mid |
| 4 | health | eslint 8.57.1 EOL warning on install; eslint 9 migration is a major bump — out of scope for /optimize, flag to owner | npm ci deprecation warnings | n/a | 0.9 | — | note |
| 5 | agent | measurement discipline: probe sweeps race other agent sessions on this box (load avg 18–21 seen); consider a load-avg guard note in probes.sh header or an idle check before sweeps | run-2 lint 7.7/15.0/2.3s spread | protects every future number | 0.8 | 15m | mid |

Done (for grep): run-1 #1 bench harness → 6c8be58; run-1 #4 .optimize/runs .ignore → 86c6e9d.
