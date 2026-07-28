# Backlog

| # | area | fix | evidence | impact | confidence | effort | score |
|---|------|-----|----------|--------|------------|--------|-------|
| 1 | data | preserve categorized parser warnings in Collection, not only malformed-session totals | run-6 provenance audit; LiveSession.parseWarnings is richer than rollup | makes missing/partial evidence actionable | 0.85 | 1.5h | high |
| 2 | health | live.test.ts hits operator home dirs (~/.ncode, ~/.codex) in two API tests — isolate via temp harness descriptors (pattern at live.test.ts:466-533) | wf_48859df9 flake agent | removes external-state test dependency | 0.85 | 45m | mid |
| 3 | data | decide duplicate-session identity semantics before cross-source deduplication | run-6 scout: archive merge dedupes IDs but live on-disk rows do not | prevents either inflated totals or lost distinct attempts | 0.65 | 1h + decision | mid |
| 4 | devloop | measure warm `next build` on an idle machine; run-6 compile was 2.1min under active load and is not a baseline | run-2/4/5/6 noise flags | unknown until measured | 0.9 | 10m | mid |
| 5 | runtime | cachePut chunk-batching in cold scans (98→77µs/put measured); needs abort-flush care | wf_48859df9 cache agent | ~30ms/cold 1,500-file scan | 0.6 | 1h | low |
| 6 | runtime | prefix-sniff to skip JSON.parse on ignored record types — only behind scripts/perf equiv nets | run-3 profile: JSON.parse ≈64% of parse cost | up to ~30% cold scan | 0.4 | 3h | low |
| 7 | health | eslint 8.57.1 EOL; major bump out of /optimize scope — owner decision | npm ci warnings | n/a | 0.9 | — | note |
| 8 | agent | openeval-dev-loop skill verify one-liner greps dead `# pass` lines (dot reporter); skill lives outside repo — owner edit | run-3 ledger | avoids false reads | 0.9 | 5m | note |

Done (for grep): run-3 items → b014e9b/ff78a27; run-4: archived two-step + stmt cache +
LRU cap + single stat/walk → 7f18db1; flaky-test pins + stability tests → cb37dec;
bench:scan + equiv-scan + ab-compare tsc fix → 74df38a; run-5: lean Live payload +
lazy detail, 30s unknown-source discovery reuse, Collection route timing, and
proof/feedback gates; run-6: exact Gemini inventory, detect-only truncation,
provenance totals, live slice boundaries, and outcome denominators. Request-level
parse sharing and the aggregate/timeline micro-passes were already present by
run-6 inspection. Closed not-worth-it: test-child tsx overhead (run-3); proposed
full-history pass fusion (run-6, 65.43ms → 69.64ms, reverted). Superseded:
load-guard → in-process A/B method notes.
