# Backlog

| # | area | fix | evidence | impact | confidence | effort | score |
|---|------|-----|----------|--------|------------|--------|-------|
| 1 | runtime | request-scoped sharing of the full-history pass (scanAllSources + buildRollup + buildTimeline currently 3 independent passes; buildRollup already takes sessionsIn) — React cache() per render, design in run-4 workflow findings | wf_48859df9 routes agent; aggregate.ts:197-274 | halves warm Collection/home load | 0.85 | 2h | high |
| 2 | runtime | measure Collection page load end-to-end (dev server route timing) before/after run-4 wins; add as probe if stable enough | run-4 ledger | banks P1-P5 as user-visible number | 0.8 | 30m | high |
| 3 | runtime | aggregate() micro-passes: fold 12 sessions.filter counts into the main loop; rateForModelInfo resolved once per session; markerImpact binary search; topEntries Intl.Collator | wf_48859df9 pipeline agent (live.ts:2450-2494, timeline.ts:181) | ~10-40ms/pass | 0.8 | 1h | mid |
| 4 | health | live.test.ts hits operator home dirs (~/.ncode, ~/.codex) in two API tests — isolate via temp harness descriptors (pattern at live.test.ts:466-533) | wf_48859df9 flake agent | removes external-state test dependency | 0.85 | 45m | mid |
| 5 | devloop | measure warm `next build` on an idle machine (43.9s cold run 1; every later attempt load-poisoned) | run-2/4 noise flags | unknown until measured | 0.9 | 10m | mid |
| 6 | runtime | cachePut chunk-batching in cold scans (98→77µs/put measured); needs abort-flush care | wf_48859df9 cache agent | ~30ms/cold 1,500-file scan | 0.6 | 1h | low |
| 7 | runtime | prefix-sniff to skip JSON.parse on ignored record types — only behind scripts/perf equiv nets | run-3 profile: JSON.parse ≈64% of parse cost | up to ~30% cold scan | 0.4 | 3h | low |
| 8 | health | eslint 8.57.1 EOL; major bump out of /optimize scope — owner decision | npm ci warnings | n/a | 0.9 | — | note |
| 9 | agent | openeval-dev-loop skill verify one-liner greps dead `# pass` lines (dot reporter); skill lives outside repo — owner edit | run-3 ledger | avoids false reads | 0.9 | 5m | note |

Done (for grep): run-3 items → b014e9b/ff78a27; run-4: archived two-step + stmt cache +
LRU cap + single stat/walk → 7f18db1; flaky-test pins + stability tests → cb37dec;
bench:scan + equiv-scan + ab-compare tsc fix → 74df38a. Closed not-worth-it: test-child
tsx overhead (run-3). Superseded: load-guard → in-process A/B method notes.
