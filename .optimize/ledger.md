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

## Run 5 — 2026-07-27 (UX+runtime+proof, 612efd6, dirty tree, estimator heuristic-chars/4, 10k tok ≈ 60s)
Focus: reduce default-page payload and repeated discovery work while making
loading, failure, evidence, and artifact states explicit instead of optimistic.
- Applied: lean Live list projection + lazy session detail. The same 100 real
  session objects serialized at 2,649,849 bytes before projection; the observed
  `GET /api/live?limit=100` response is 171,020 bytes (−93.5%). List rows retain
  summary metrics and at most 24 usage-rate points; tool/file/timeline detail is
  fetched only when the drawer opens. The stable Hermes signature-only poll is
  71 bytes. Drawer loading/error/retry, stale-request guards, focus containment,
  focus restoration, and body-scroll locking were browser-verified.
- Applied: cache unknown transcript-source discovery for 30 seconds, keyed by
  the configured known roots. Known-source fingerprints and content sentinels
  still revalidate on every fresh scan. The deterministic performance contract
  proves warm scans do no repeated unknown-root discovery and do only bounded
  head/tail sentinel reads. Warm `GET /api/collection?limit=80` samples were
  0.547/0.208/0.156/0.201/0.172s (median 0.201s); this is a route receipt, not a
  strict before/after percentage because process load and cache state differed.
- Applied: proof honesty sweep. Visual coverage now uses visual cases as its
  denominator (the old formula could display 300–400%); persisted evidence tiers
  cannot elevate the tier beyond the current grader contract; expected artifacts
  are labelled as contracts rather than observed proof. Artifact responses add
  byte count, SHA-256, modified time, ETag, and 304 support, and the UI states
  plainly that byte receipt does not automatically verify visual quality.
  Dashboard collection/timeline failures are distinct from empty data, Accuracy
  uses strict case loading, and CI now runs the strict known-bad audit.
- Applied: interaction feedback and accessibility. Case selection is a native
  button sibling to checkbox/re-run controls; Timeline reports fresh/loading/
  stale/error states, retains its last good report, exposes retry/judge errors,
  prevents overlapping polls, and stops after terminal/no-op responses. The
  sidebar version now comes from package metadata, eliminating the observed
  v0.1.0 vs package 0.1.2 drift.
- Probes before: types 11.074s, test 11.910s, lint 3.492s, bench 2.820s.
  Final: types 2.983s; test median 11.488s (10.142/11.488/13.023); lint 3.351s;
  bench median 3.364s (3.237/3.364/3.800), recheck 3.447s. The optimizer's
  cross-process bench delta looked like a 19–22% regression, but an immediate
  isolated same-machine baseline/current comparison contradicted it: baseline
  claude 479/851/517ms and codex 308/468/333ms; current claude 416/385/395ms and
  codex 283/338/287ms. Rejected the wall-time regression as machine-load noise.
- Gates: 519 tests, typecheck, lint, strict accuracy (24/24 oracle + known-bad),
  selftest (49 pass, 6 LLM skips), public-upload audit, doctor, production build,
  and Chrome checks across dashboard/Live/Timeline/Accuracy/run detail, desktop
  dark/light, and narrow viewport. Browser console errors: none.
- Next run: request-scope the repeated full-history aggregate pass, then profile
  the remaining aggregation micro-passes. Preserve the payload and discovery
  contracts as regression gates.

## Run 6 — 2026-07-27 (data+runtime+proof, 612efd6, dirty tree, estimator heuristic-chars/4, 10k tok ≈ 60s)
Focus: correct source inventory, expose denominator/provenance boundaries, and
accept only measured performance changes.
- Applied: exact detect-only inventory. Gemini previously walked both
  `~/.gemini/tmp` and all of `~/.gemini` for every JSON/JSONL file, counting
  browser profiles, IDE/config data, and tool environments as 707 session files.
  It now detects only per-project `logs.json` under `~/.gemini/tmp`: 707 → 1.
  Same-machine `discoverKnownSources()` samples changed from
  94/59/57/65/56/60/88ms (median 60ms) to 39/39/30/23/22/26/24ms
  (median 26ms, −57%). Global inventory changed 3,022 → 2,318 during the run;
  the net is −704 because two unrelated live files appeared, while Gemini's
  source-specific correction is exactly −706. Exact-name/suffix detection and
  max-depth/cap truncation reasons are regression-tested.
- Applied: Collection data fidelity. The final live rescan separates 2,193
  parseable files from 127 detect-only files and 1,390 parsed sessions. It now
  exposes 1,085 measured-usage sessions, 46 missing-model sessions, 305
  missing-token sessions, 1,069 inferred-cost sessions, and malformed/stale
  counts. Parse-budget partials and bounded detect-only inventory lower bounds
  have separate visible warnings; no invalid file/session coverage ratio is
  manufactured.
- Applied: population and outcome denominators. Final
  `/api/live?harness=codex&limit=50` reports 1,705 discovered files, 50
  scanned/parsed, 0 dropped, and 1,655
  unscanned; every usage/quality total is labeled as that latest slice.
  Timeline reports exact counts (1,390 total; 982 signal; 325 judged; 657
  heuristic signal; 408 no signal). Adoption rows now distinguish the complete
  before/after windows from the actual judged/signal samples used by medians and
  suppress an outcome delta when either side has no usable evidence.
- Applied after independent proof review: Collection now propagates the parser's
  own hard scan-cap receipt into `partial`/`partialSources`, even when no request
  budget was set, so a safety cap cannot silently look complete. Detect-only
  depth/cap probes are tri-state: small unrelated subtrees are proven complete,
  while a match, unreadable subtree, or exhausted evidence budget remains
  conservatively partial. Both edge paths have fixtures; the 102-test focused
  data suite, full suite, typecheck, lint, production build, public-upload audit,
  and a second read-only judge pass are green.
- Rejected: fusing the Collection aggregate and full-history collection pass.
  A controlled 1,200-session warm-cache benchmark kept output shape identical
  but moved median 65.43ms → 69.64ms. The change was reverted; no speculative
  optimization was shipped. The earlier backlog claim of three independent
  page passes was also stale: current pages already share the snapshot.
- Probes before → final: types 3.259s → 2.019s; full test median 10.957s →
  9.103s; lint 3.227s → 3.455s (noise-sized +7.1%); live bench 3.501s →
  2.838s. Discovery has the causal A/B above; cross-process probe deltas are
  health receipts, not attributed speedups.
- Gates: 525 tests (the measured full suite passed three times, plus a final
  explicit run), focused 90-test data/collection/live/timeline suite, typecheck,
  lint, diff check, and production build. Chrome QA passed on Collection, Live,
  and Timeline in dark/light and 1,418px/390px layouts with no page-level
  horizontal overflow or console errors. Dev server restored on port 3000.
  Auxiliary SIPS homebase verification returned `source_not_found` because this
  is not a homebase package and lacks its two validator scripts; that result is
  not counted as a green gate or as an OpenEval failure.
  The post-review hard-cap regression was followed by another complete
  `npm test` pass and the 102-test focused suite above.
