# Backlog

| # | area | fix | evidence | impact | confidence | effort | score |
|---|------|-----|----------|--------|------------|--------|-------|
| 2 | health | live.test.ts hits operator home dirs (~/.ncode, ~/.codex) in two API tests — isolate via temp harness descriptors (pattern at live.test.ts:466-533) | wf_48859df9 flake agent | removes external-state test dependency | 0.85 | 45m | mid |
| 3 | data | decide duplicate-session identity semantics before cross-source deduplication | run-6 scout: archive merge dedupes IDs but live on-disk rows do not | prevents either inflated totals or lost distinct attempts | 0.65 | 1h + decision | mid |
| 4 | devloop | measure warm `next build` on an idle machine; run-11 measured the current dirty checkout at 113.854s with the dev server stopped | `.optimize/runs/20260730T204612.json` | build remains the dominant devloop cost; no safe behavior-preserving fix identified yet | 0.9 | 10m | measured |
| 5 | runtime | cachePut chunk-batching in cold scans (98→77µs/put measured); needs abort-flush care | wf_48859df9 cache agent | ~30ms/cold 1,500-file scan | 0.6 | 1h | low |
| 6 | runtime | prefix-sniff to skip JSON.parse on ignored record types — only behind scripts/perf equiv nets | run-3 profile: JSON.parse ≈64% of parse cost | up to ~30% cold scan | 0.4 | 3h | low |
| 7 | health | eslint 8.57.1 EOL; major bump out of /optimize scope — owner decision | npm ci warnings | n/a | 0.9 | — | note |
| 8 | agent | openeval-dev-loop skill verify one-liner greps dead `# pass` lines (dot reporter); skill lives outside repo — owner edit | run-3 ledger | avoids false reads | 0.9 | 5m | note |

Run 11 token findings: surface context is 3,561 tokens with no duplicated surface text; probe output is 1,112 tokens; refetch waste is 471 tokens (0.0% of tool-result tokens) across 52 repeated calls; and 104/105 generated paths are already ignored. The only unignored generated-like text is the required tracked `package-lock.json` at 66,967 estimated tokens, so no token fix clears the 2k-token / 10% acceptance threshold without harming repository behavior or reproducibility.

Done (for grep): run-3 items → b014e9b/ff78a27; run-4: archived two-step + stmt cache +
LRU cap + single stat/walk → 7f18db1; flaky-test pins + stability tests → cb37dec;
bench:scan + equiv-scan + ab-compare tsc fix → 74df38a; run-5: lean Live payload +
lazy detail, 30s unknown-source discovery reuse, Collection route timing, and
proof/feedback gates; run-6: exact Gemini inventory, detect-only truncation,
provenance totals, live slice boundaries, and outcome denominators; run-7:
full-population parser-warning taxonomy, explicit child-agent provenance,
task-focused panel unmounting, generation-bound pagination, completion-stamped
snapshots, and 30-second analytics reuse; run-8: parser-context cache identity,
pruned-source archive retention, read-only cache hits, bounded head+tail FTS,
and progressive Live/Timeline row windows. Request-level
parse sharing and the aggregate/timeline micro-passes were already present by
run-6 inspection. Closed not-worth-it: test-child tsx overhead (run-3); proposed
full-history pass fusion (run-6, 65.43ms → 69.64ms, reverted). Superseded:
load-guard → in-process A/B method notes.

2026-09-12: same-snapshot repeated report caching implemented and measured in analysis-repeat (-90.3% process median). Cold scan/build items remain. Setup now uses production launch after one build, so ordinary users do not pay development compilation on each route.

## 2026-09-13 measured update
1. Devloop: profile initial server file tracing against a controlled runtime-data snapshot; baseline 99.89s of 130.286s build. First define packaging semantics; outputFileTracingExcludes does not bypass the installed plugin's initial traversal.
2. Runtime: retain cold analysis-filter (2.767s) and warm analysis-repeat (0.407s) as distinct workloads; no new runtime optimization demonstrated.
3. Health: revalidate the previously recorded operator-home test dependency before changing isolation. This run's test repetitions all passed; historical risk is not a current failure.
Closed agent note: the dot-reporter/TAP-grep skill instruction was corrected in the preceding Retro. Worker flag hypothesis rejected for lack of a reliable win (130.286s ->138.518s; restored275.466s), not a proven causal slowdown.
