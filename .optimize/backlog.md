# Backlog

| # | area | fix | evidence | impact | confidence | effort | score |
|---|------|-----|----------|--------|------------|--------|-------|
| 1 | runtime | create minimal benchmark for lib/live.ts session scan (cold vs warm cache) — no runtime harness exists | openeval-dev-loop skill: cold scan ~25s incl. 567MB codex file; no bench probe today | high (unlocks all runtime runs) | 0.9 | 1h | high |
| 2 | devloop | test suite child-process overhead: 28 files × tsx import under node --test; try shared compile cache or fewer processes | probe: test 9.7s median for ~110 fast tests | ~5s/run × many runs/wk | 0.6 | 1h | mid |
| 3 | devloop | measure warm `next build` (43.9s was cold, fresh worktree); only then consider build fixes | run 1 baseline, runs=1 cold | unknown until measured | 0.9 | 10m | mid |
| 4 | tokens | add .optimize/runs/ to .ignore — measurement artifacts self-inflate repo_tokens (+12.4k in one run) | verify-tokens delta 385.5k → 397.9k | ~1k/errant grep | 0.8 | 2m | low |
| 5 | health | eslint 8.57.1 EOL warning on install; eslint 9 migration is a major bump — out of scope for /optimize, flag to owner | npm ci deprecation warnings | n/a | 0.9 | — | note |
