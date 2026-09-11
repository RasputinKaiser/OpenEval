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

## Run 7 — 2026-07-28 (Observe UX+data+runtime, dirty tree)
Focus: make Live, Collection, and Timeline task-focused, responsive, explicit
about evidence quality, and complete across parent and child-agent storage.
- Applied: bounded Claude child discovery for direct subagents and nested
  workflow `agent-*.jsonl` files, plus Codex parent/child linkage and ncode
  sidechain preservation. The exact machine snapshot contains 2,278 parsed
  sessions and 1,188 child traces: Codex 313, Claude 576, ncode 299. Timeline
  excludes those children from human-outcome denominators while still using the
  complete corpus for first-seen adoption markers.
- Applied: full-population measured/inferred/missing provenance and categorized
  parser-warning counts. Live and Collection render accessible patterned
  evidence-composition bars; Timeline separates judged, heuristic, and no-signal
  populations instead of presenting one blended confidence number.
- Applied: task-focused progressive navigation on all viewports. Inactive heavy
  panels are unmounted and restored for print/All mode. Exact production desktop
  DOM changed from Live 3,197 → 304, Collection 2,761 → 320, and Timeline
  2,797 → 325 elements. All three pages remained free of horizontal overflow at
  1,280px and 390px; narrow dense panels rendered 428/441/333 total elements.
- Applied: generation-bound Collection cursors reject reordered snapshots with
  409 and trigger an atomic client refetch. Snapshot freshness is stamped after
  rollup/timeline derivation completes, analytics reuse matches the API's
  30-second window instead of rescanning every five seconds, and Timeline
  retries bypass cached stale responses. Browser proof observed stale → fresh
  automatically with Retry removed.
- Gates: production build completed with type/lint validation; standalone
  typecheck and lint passed; the 70-test focused data/UI suite and a serial full
  suite passed. One earlier parallel full-suite sample had a load-sensitive
  process-group timeout fixture miss while load average exceeded 120; its
  complete 33-test file passed immediately in isolation, then the full suite
  passed with test concurrency 1. `git diff --check` passed. Wall-clock build
  and suite timings are not attributed performance results because machine load
  reached 264. No commit, push, deploy, tag, or media mutation.

## Run 8 — 2026-07-28 (Observe accuracy+durability+density, dirty tree)
Focus: retain truthful parent/child history, prevent cache-context corruption
and write amplification, and keep dense Live/Timeline views responsive.
- Applied: Collection now asks every parseable source for its archived view
  even when the physical root is empty or absent. The source status remains
  truthful while pruned session summaries continue to contribute to Collection
  and Timeline. Parser cache identity now includes stable parser/source/project/
  field/inferred-model context through an additive SQLite migration; a same-file
  model-A/model-B fixture proves the second parse cannot receive model A.
- Applied: normal interactive Claude/ncode transcripts no longer become
  "incomplete" solely because they have no final result record. Old archived
  cache rows normalize that exact stale warning. The production Collection
  fidelity view changed from roughly 1.4k false incomplete traces to 0 while
  leaving malformed/runtime categories intact.
- Applied: durable, low-write storage. Parsed summaries survive source pruning;
  parser cache hits and identical puts are read-only SQL paths. WAL mode remains
  synchronous=NORMAL, explicitly auto-checkpoints at about 4 MiB, and limits a
  reset journal to 8 MiB. The observed cache is 32.85 MB for 3,510 rows with
  28.32 MB of summary JSON. Three individually warmed production API reads
  left both DB and WAL size/mtime unchanged. Optional FTS now retains a bounded
  32k-character head+tail per side (task framing plus eventual result) instead
  of the first 100k characters per side.
- Applied: Live zero values use evidence coverage rather than numeric
  truthiness, anomaly search includes child lineage/branch/provenance/warnings,
  actionable warnings sort first with an omitted-count affordance, drawer
  metric cards surface provenance, mobile rows have field labels, Collection
  keeps the session identity sticky, and unmounted section buttons no longer
  expose broken aria-controls references. Timeline labels adoption filters
  separately from global shifts and derives its legend from visible kinds.
- Applied: progressive row windows preserve access with Show-more controls.
  Exact optimized-production DOM changed: Live Sessions 3,032 → 1,718 elements
  (-43.3%, 50 → 25 rows), Timeline Impact 1,333 → 839 (-37.1%, 37 → 20),
  and Timeline Adoptions 1,717 → 632 (-63.2%, 130 → 30). The inspected routes
  had no page-level horizontal overflow. Collection now follows a background
  snapshot refresh so its amber banner clears without a second manual rescan.
- Probes before → final: types 3.783s → 2.770s; full-test median 11.650s →
  8.790s across three green 563-test runs; lint 2.411s → 2.800s; live-bench
  median 2.087s → 2.240s. Wall-clock deltas are health receipts, not attributed
  speedups; the post benchmark's direct parser medians remained strong
  (Claude 372ms cold, Codex 239ms cold, both 0.1ms warm).
- Gates: 105 focused accuracy/cache/UI tests, three full 563-test passes,
  standalone typecheck, lint, live benchmark, diff check, two optimized
  production builds, production API write-stability probe, and direct browser
  proof on Live, Collection fidelity/sessions, and Timeline impact/adoptions.
  No commit, push, deploy, tag, or user-media mutation.

## Run 9 — 2026-07-28 (Collection visualization system, dirty tree)
Focus: materially improve the six user-marked Collection visualization surfaces
without adding a charting dependency or weakening the data's evidence labels.
- Applied: Overview groups now use one readable headline metric plus two
  supporting metrics instead of three cramped equal cells. Weekly Usage adds
  four metric modes, selected-week/prior/window context, scale lines,
  focus/tap selection, exact tooltips, and per-week inferred-cost provenance.
  The rollup now retains `estimatedCostSessions` per bucket so an estimate in
  one week no longer marks every week's displayed value.
- Applied: the project ranking states its all-time scope, exposes rank,
  sessions, I/O tokens, recency, and value share, and progressively expands
  from four to eight selectable rows. This fixes the visual mismatch between a
  16-week chart and an all-history ranking without changing aggregation scope.
- Applied: Rhythm adds an exact selected-hour summary, larger interactive heat
  cells, intensity legend, keyboard-persistent selection, selectable day-part
  composition, and readable busiest-day/peak-hour/weekend context. Zero-value
  day-part and project bars now remain zero-width.
- Applied: Models adds three leader summaries, live model search, six sort
  modes, semantic table/row headers, explicit "tool error rate" wording,
  larger share bars, and complete recorded/allocated/listed/family/fallback
  estimate provenance. Allocated costs now retain the estimated `~` marker.
- Applied: grid items align to their own content height, avoiding the large
  false-empty regions caused by CSS Grid stretch. Chart canvases collapse to
  the card width at desktop while keeping intentional internal scrolling below
  the desktop breakpoint. All marks remain bounded DOM/CSS; dependencies and
  collection payload cardinality are unchanged.
- Browser proof: project expansion exposed 8/8 rows and project selection
  persisted; model search reduced 35 → 3 rows and session sort promoted
  `gpt-5.6-luna`; heatmap and day-part controls both retained pressed state.
  At the desktop proof width, Usage and Rhythm scrollers each measured
  515px/515px scroll/client width. Page-level overflow was false, and the
  inspected production console log was empty. The narrower final capture
  stacked the project card and retained chart-only horizontal scrolling.
- Gates: full `npm test`, focused 18-test rollup/visualization suite,
  standalone typecheck, warning-free lint, `git diff --check`, and the final
  optimized production build passed. `/collection` is 21.8 kB route JS and
  131 kB first-load JS. Build wall time varied from 77 seconds to 2.5 minutes
  under machine load and is treated only as a health receipt.
- Auxiliary SIPS homebase verification was not applicable: OpenEval does not
  contain `scripts/validate_harness.py` or `scripts/validate_v2.py`. Its rc=2
  result is recorded, not counted as a green product gate. Production server
  restored on port 3000; no commit, push, deploy, tag, or media mutation.

## Run 10 — 2026-07-28 (System Harnesses + Settings, dirty tree)
Focus: turn the two System routes into responsive operational tools while
making capability, persistence, override, and storage evidence explicit.
- Applied: Harnesses now consumes every field already promised by its API:
  available/default counts and invalid descriptor issues are visible, errors
  are retryable, refresh bypasses both client and HTTP caches, selection is
  URL-restorable and keyboard navigable, and per-harness probes cannot replace
  valid state with an error envelope. Missing executables still receive a
  descriptor-built sample command.
- Applied: discovery exposes a bounded integration contract (parser, prompt
  transport, model aliases/default/discovery, and live-trace roots/format/
  depth/inferred model). The UI separates descriptor declarations from safe
  version/help probe evidence, distinguishes declared image support from a
  help-observed flag, redacts displayed local paths, and explains that nested
  child traces are eligible without claiming every file parsed successfully.
- Applied: Settings separates browser-local run defaults, machine-persisted
  global judge fallback, immediate privacy state, and local SQLite storage.
  Saved, environment, and effective fallback values are visualized as a
  resolution chain and correctly caveated because per-rubric overrides still
  win. The settings GET is now local-host gated and custom judge model ids
  reject control characters/unbounded values.
- Applied: localStorage defaults are validated and integer-clamped before New
  Run consumes them; the small defaults module no longer pulls the Settings
  page bundle into New Run. Settings and harness registry fetches fail
  independently. Save writes the server first and reports any browser-local
  partial failure, reset requires confirmation, and dirty scopes are explicit.
- Applied: the prior one-line truncated database JSON is replaced by DB/WAL/
  reclaimable/record metrics, a storage composition bar, and explicit Quick
  check, Full check, WAL checkpoint, and confirmed Vacuum actions. None runs on
  a timer; the production quick integrity check passed. A shared System local
  nav makes Harnesses and Settings mutually reachable at every breakpoint.
- Browser proof: production keyboard selection updated
  `?harness=codex` to `?harness=ncode`; ncode probe and uncached four-harness
  refresh completed; Settings dirty/save/restore and reset confirmation worked;
  the database quick check passed. At an exact 390x844 Chrome viewport, both
  documents measured 379px scroll/client width (no horizontal overflow), the
  mobile Settings action bar remained above normal page flow instead of
  covering the fixed mobile nav, and browser error/warning logs were empty.
  Intermediate 805px proof also had equal scroll/client width.
- Gates: final 56-test System/API/storage/harness suite, earlier 75-test expanded
  focused suite, full `npm test`, standalone typecheck, warning-free lint,
  `git diff --check`, and an optimized production build passed. Final route
  sizes are 9.24 kB for Harnesses, 11.2 kB for Settings, and 7.6 kB for New Run;
  no visualization dependency was added. Auxiliary SIPS homebase verification
  remained not applicable because OpenEval does not ship the SIPS harness
  validator scripts. Production server restored on port 3000; no commit, push,
  deploy, tag, or media mutation.

## Run 11 — 2026-07-30 (tokens + devloop, dirty tree)
Focus: measure the current development loop and context sinks without changing
OpenEval behavior or treating dirty-checkout timings as clean-release claims.
- Baseline probes from `.optimize/runs/20260730T204612.json`: types 1.868s,
  full-test median 11.447s across three green runs, lint 2.707s, production
  build 113.854s with the dev server stopped, and live benchmark median 2.160s
  across three green runs. The build is the dominant measured devloop cost.
- Token baseline from `.optimize/runs/20260730T204612-tokens.json` used the
  same frozen parent Codex transcript plus eight project Claude transcripts:
  surfaces 3,561 tokens, probe output 1,112, refetch waste 471 tokens across
  52 repeated calls, and 3,627,026 tool-result tokens. Repo context measured
  255,236,501 tokens, but that is not a target; 104/105 generated paths are
  already ignored and the remaining unignored text is the required tracked
  `package-lock.json`.
- Ranked candidates: the warm-build item is now measured but lacks a safe
  behavior-preserving fix; the token sinks are below the acceptance threshold
  or would remove useful/reproducibility-critical content. No fix was applied,
  because forcing one would manufacture a win or weaken the project.
- Verification: all baseline probes passed and the build ran with no dev server
  attached. No source files, public APIs, tests, or user WIP were changed. The
  existing `.optimize/` changes remain uncommitted because this checkout
  already contained optimization-ledger edits unrelated to this run.
- Next run: measure a warm build once more on a comparably idle machine, then
  revisit backlog #4; do not pursue token changes unless a named sink exceeds
  the 2,000-token / 10% threshold.

## Run 12 — 2026-09-11 (interactive analysis baseline, b5ef8df-derived working tree)
- Pre-edit validation through measure.py: types 2.556s; full test median 13.414s (13.109, 13.414, 15.490); lint 3.141s. All passed.
- Build probe passed at 161.407s. New unimported chart files and CSS were being prepared during the build, so this timing is not a stable before/after optimization baseline.
- Fixed 400-point scatter SSR probe initially failed because the standalone tsx runner used classic JSX (React is not defined). Corrected the probe's tsconfig to react-jsx without changing application code. Failed and corrected raw runs are retained under ignored .optimize/runs/.
- Corrected chart process median: 0.605s (0.785, 0.597, 0.605). Separate detail sample: 25 warm renders, median 3.504ms, p95 5.950ms, 124,556 HTML bytes. SSR measurements do not prove browser interaction latency.
- No optimization improvement claimed. This run is feature expansion plus correctness; compare only equivalent fixed workloads and preserve evidence of failures.
- Next: implement bounded analytical summaries and interactions, measure the same scatter fixture after changes, and record correctness/performance separately.

## Interactive analysis — scatter expansion checkpoint (2026-09-11, codex/interactive-analysis, dirty)
- Fixed 400-point, 5-warmup/25-render workload promoted to scripts/perf/chart-render.tsx and probes.sh.
- measure.py process median: baseline 0.605s → expanded 0.812s (+0.207s); below the 2s absolute noise threshold. No speed improvement claimed; this is a feature expansion with accessible tables and overlap evidence.
- Raw after measurement: runs/20260911-chart-expanded.json; render detail: runs/20260911-chart-render-expanded-detail.json. These are SSR timings, not browser interaction latency.
- Next run: reuse scripts/perf/chart-tsconfig.json (jsx react-jsx); standalone tsx otherwise uses classic JSX and fails with React is not defined.
