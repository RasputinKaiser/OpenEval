# OpenEval optimization ledger

Conventions: exchange rate 10k wasted tokens ≈ 60s. Estimator recorded per run.
Probes: see probes.sh. Never run the `build` probe while a dev server serves the
same checkout (openeval-dev-loop skill).
runs/ is LOCAL-ONLY (gitignored): raw measure/tokens JSONs embed absolute
machine paths and transcript excerpts, which scripts/public-upload-audit.sh
rejects for this public repo. Copy any number worth keeping into this ledger;
cross-machine comparisons were already invalid (hard rule: same machine only).

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

## Run 2 — 2026-07-18 (full, b29139e, clean tree, estimator heuristic-chars/4, 10k tok ≈ 60s)
MEASUREMENT NOISE FLAG: machine load avg 18–21 (other agent sessions). The same
lint command measured 7.7s (run 1) / 15.0s (run 2 sweep) / 2.3s (idle recheck,
eslint cache warm) with zero relevant code change. Cross-run wall-times on this
box are unreliable; only back-to-back A/B pairs within one run count as evidence.
- Probes (warm caches): types 5.3s (cold 19.7s run 1, −73% — incremental working), test 12.7s @ 75 tok output, lint noisy (see flag), build 52.5s under load (cold 43.9s — backlog #3 stays open, number is load-poisoned).
- Applied: optimize: runtime benchmark for live-session parsing (6c8be58) | new `npm run bench:live` + `bench` probe. Baseline: claude-projects 71.8MB/s cold, codex-sessions 105.0MB/s cold, warm cache hit <1ms; probe median 2.91s, 28 tok output. Deterministic 32MB corpora from golden fixtures; in-memory cache DB; never reads real session dirs. Closes run-1 backlog #1.
- Applied: optimize: .ignore .optimize/runs/ (86c6e9d) | rg file set for .optimize: 4 files (ledger/backlog/baseline/probes), runs/*.json out. Closes run-1 backlog #4.
- Verified green after fixes: tsc, lint (0 warnings), test ×3 (run-2 sweep), bench ×4.
- Tokens: probe outputs now test 75 / lint 67 / build 801 / bench 28 — no loud probes left. Session mining skipped (no session-area fix this run; run-1 snapshot remains the reference set).
- Backlog: top 3 below.
- Next run: bench probe is the harness — attempt one parser optimization. Lead: claude-projects parses 30% slower than codex (71.8 vs 105.0MB/s) on same-size corpora; profile parseLiveSession before touching anything, and verify with back-to-back bench medians in the same process batch (machine-load flag above).

## Run 3 — 2026-07-18 (runtime, e68f23d, clean tree, estimator heuristic-chars/4, 10k tok ≈ 60s)
Worked backlog #1 (parser hot path). CPU profile attributed the claude/codex gap:
parseTimestamp 213.8ms (Date.parse/record), tokenSet+sentiment regexes ~360ms,
GC 140.9ms, vs an I/O floor ~460ms.
- Applied: optimize: cut live-parser per-record costs (b014e9b) | in-process interleaved A/B (8 samples/side, ×2 runs): claude 842→656ms (−22.1%) @load≈28 and 373→331ms (−11.1%) @load≈14; codex 304→253ms (−17.0%) and 217→203ms (−6.6%). Post-fix profile: parseTimestamp 213.8→118.6ms, tokenSet 207.5→38.9ms, GC 140.9→80.3ms, readFileLines 163.0→89.6ms. Output equivalence: sha256 identical 116/116 entries (goldens + 2×32MB corpora + 9 nasty fixtures + 10 real transcripts/67MB); fastIso fuzz 700,027 strings / 0 mismatches; PARSER_VERSION unchanged (byte-identical outputs). Suite green, lint 0 warnings.
- Applied: optimize: perf-refactor verification harness (ff78a27) | scripts/perf/{equiv-dump,ab-compare,fuzz-fastiso,gen-nasty} — makes the next parser change's verification ~free (meta-rule).
- Closed backlog #2 as not-worth-it: tsx child startup 0.44s vs 0.17s user-CPU (strip-types) ×28 test files ≈ <1s wall across parallel workers, against a repo-wide .ts-extension import rewrite. Numbers recorded; do not retry.
- CONSEQUENCE NOTE (from run 1's dot reporter): `npm test` piped output no longer emits `# pass/# fail` TAP lines — the openeval-dev-loop skill's verify one-liner greps for them and now matches nothing. Judge by exit code, or ask the owner to update the skill.
- Measurement method note: cross-process bench runs at load 14–30 swung ±40%; the accepted numbers come from scripts/perf/ab-compare.ts (both module graphs in ONE process, alternating AB/BA) — use it for all future parser A/Bs.
- Backlog: top 3 below.
- Next run: parser is near its I/O+JSON.parse floor (remaining self-time is JSON.parse per line, ~64% of parse cost). Candidates: (a) prefix-sniff to skip JSON.parse on record types both parsers ignore — HIGH equivalence risk, needs the equiv net; (b) shift runtime focus to scanSourceSessions end-to-end (directory walk + cache-hit path) or dashboard route timings; (c) devloop backlog #3 (warm build on idle machine). Session-token comparisons: run-1 snapshot set only.

## Run 4 — 2026-07-18 (runtime+health, 9f5397e, clean tree, estimator heuristic-chars/4, 10k tok ≈ 60s)
Focus: scan pipeline around the parser + stability ("performance and stability").
New harness: `npm run bench:scan` (cold/warm/hot over deterministic 85MB corpus) +
scripts/perf/equiv-scan.ts (scan-layer output hashes). First numbers: cold ≈ parser
speed (89.7MB/s page-cache-warm), warm 26-50ms/90 files, hot 4-7ms.
- Applied: optimize: scan-pipeline performance + cache stability hardening (7f18db1)
  | archived-merge two-step read 144.9ms → 8.1ms (17.8×, real-DB copy, 1,258 rows,
  identical 14 pruned sessions both paths; runs 2-4×/Collection load — the workflow
  agent measured 469ms/call on the same table under load, ~0.9-1.9s/page-load).
  Statement cache (prepare was 2.5× lookup cost, agent-measured 84.6→34.2ms/1,500
  gets). SESSION_CACHE_LIMIT 500→4000 + LRU (FIFO flooding gave ~0% memory hits at
  1,500 files). One statSync/file instead of two; discovery walk reused by scan
  (was two full walks per pass). Equivalence: equiv-scan 8/8 hashes identical
  incl. archived path (9+4 archived sessions exercised); suite green; lint clean.
  STABILITY (confirmed-repro bug): transient fs errors during parse were cached as
  PERMANENT null tombstones (sessions silently vanish until file mtime changes) —
  parsers now rethrow errno-carrying errors so the file is skipped uncached;
  torn/garbage cache rows now gate to miss instead of crash; corrupt cache DB now
  renamed aside + rebuilt once (was sticky-dead until manual delete). All three
  pinned by tests/cache-stability.test.ts.
- Applied: optimize: pin flaky tests (cb37dec) | week-boundary Date.now bomb,
  killed-run settings poison, pid-reuse workdirs, two files racing the shared
  .test-data SQLite DB across parallel test processes. Suite 5×-green baseline
  (222→228 tests now).
- Applied: optimize: bench:scan + equiv-scan harness; ab-compare defect fix (74df38a)
  | run-3's ab-compare statically imported .test-data/oldlib → tsc broke whenever
  no snapshot existed. Committed-state typecheck was red; now dynamic require.
- Measurement notes: machine load hit 122 (!) during final benches — scan-bench
  absolutes from today are load-poisoned; the accepted numbers are the real-DB
  micro-bench (17.8×) and byte-identical equivalence hashes. bench corpus files
  share one sessionId (repeated fixture) — equiv-scan rewrites ids + pins mtimes;
  scan-bench inherits the limitation (fine for timing, useless for archived-path
  counts).
- Deferred with design attached (workflow wf_48859df9): request-scoped sharing of
  the full-history pass between scanAllSources/buildRollup/buildTimeline (React
  cache()); cachePut chunk-batching; /live TTL memo (staleness semantics change);
  busy_timeout tuning; readFileLines giant-line cap (behavior change); walk
  warning for skipped symlinked dirs; live.test home-dir dependency isolation.
- Backlog: top 3 below.
- Next run: measure a Collection page load end-to-end (route timing, dev server)
  to bank the P1-P5 wins as a user-visible number, then take backlog #1
  (request-scoped sharing) with equiv-scan as the gate. Machine-load flag applies
  to every wall-clock number.
