# OpenEval UX/Stability Batch Plan

For: Fable 5 High coordinator running `/batch` in this repo. 14 independent units, exclusive file ownership, per-unit gates. Keep this file untracked.

## Baseline (verified 2026-07-19)

- v0.1.1 tagged; working tree clean (untracked `media/`, `videos/`, one jpg are intentional).
- `npm test` 282/282 pass (4.5s). Lint, typecheck, build green at tag.
- Sole open GitHub issue #24 ("Needs Expanded Evals") is case content — out of scope here; do not close it.
- Largest files: `lib/live.ts` 2,399 lines; `components/RunDetailClient.tsx` 1,256; `components/LiveClient.tsx` 1,209; `components/CollectionClient.tsx` 670.
- **Codex CLI quota is exhausted until 2026-07-25** — do not delegate any work to `codex exec` during this batch (it fails with a usage-limit error). For programmatic LLM-judge calls, use OpenRouter free/cheap models (`OPENROUTER_API_KEY` is in the shell env).

## Hard rules (every worker)

1. **File ownership is exclusive.** Touch only files your unit owns. If a change seems to require another unit's file, note it in your report instead of editing.
2. **New tests go in NEW files** (`tests/<unit-slug>.test.ts`). Editing an existing test file is allowed only for the unit listed as its owner.
3. **Shared files:** only U09 may edit `app/globals.css` / `tailwind.config.ts`; only U14 may edit `package.json` / CI workflows. `lib/types.ts` edits are append-only; prefer unit-local types.
4. **No new runtime dependencies** without operator approval typed in chat.
5. **Public-repo hygiene:** nothing committed may contain the operator's legal name, `/Users/<name>` paths, or `data/` contents. Anything you commit must pass `scripts/public-upload-audit.sh`.
6. **Never touch `data/`** (real operator history). Tests use `OPENEVAL_DATA_ROOT=.test-data` (npm scripts already set it).
7. Commit on your unit branch; **do not push, open PRs, or tag** — the coordinator integrates, the operator approves pushes.
8. Run any review/verification synchronously; **never end your turn with background sub-work pending.**
9. Preserve behavior contracts: redaction defaults ON; measured/inferred/missing provenance must never collapse into fake zeroes; error vs failed outcome precedence is load-bearing.
10. End your final commit message body with `[unit:UXX]` so the coordinator can grep unit signatures post-merge.

## Per-unit verification gates

Every unit, before reporting done:

- `npm test` (all pass, count must not drop below 282), `npm run typecheck`, `npm run lint`, `npm run build`.
- Units marked **[QA]** additionally: dev server browser QA — zero console errors/warnings, no horizontal overflow, light AND dark theme, 1440×1000 and 390×844 viewports, on every route the unit touches. Record what you checked in the unit report (receipts style).
- Units marked **[parity]**: refactors must produce identical outputs — capture representative API/JSON output on test fixtures before refactor, diff after, include the diff-clean statement in your report.

---

## Units

### U01 [STABILITY] [parity] Split lib/live.ts into modules + parser fuzz hardening
**Owns:** `lib/live.ts` (becomes re-export shim or is replaced), new `lib/live/*`, `tests/live.test.ts`, new `tests/live-fuzz.test.ts`.
**Why:** 2,399-line single module handles scanning, parsing (ncode/Codex/legacy), provenance, intelligence extraction, and redaction wiring; it is the highest-risk file to edit and the most common regression site.
**Do:** Extract scan/discovery, per-source parsers, provenance, trace-intelligence, and summary assembly into `lib/live/` modules with the existing public API preserved exactly. Then add fuzz tests: truncated JSONL lines, interleaved garbage, multi-MB single lines, non-UTF8 bytes, empty files, deeply nested JSON — parser must degrade to `malformed`/`missing` provenance, never throw to the route.
**Done when:** parity diff clean on fixture corpus; fuzz cases pass; no file in `lib/live/` exceeds ~500 lines.

### U02 [UX] [QA] Decompose and polish RunDetailClient
**Owns:** `components/RunDetailClient.tsx`, new `components/run-detail/*`, `components/RunTimeline.tsx`, `components/ArtifactPreview.tsx`.
**Why:** 1,256-line client component; run detail is the product's core reading surface.
**Do:** Split into section components (header/confidence/case list/evidence groups/artifacts/events). While splitting: collapse/expand state for long sections persisted per run in localStorage; sticky case-list navigation on tall pages; copy-to-clipboard on run id, case id, and final answers; visible loading affordance for artifact iframes; keep the confidence layer and evidence-tier grouping pixel-equivalent unless a change is a clear win (screenshot before/after if you change it).
**Done when:** no component file over ~400 lines; QA receipts on `/runs/[id]` and `/runs/[id]/case/[caseId]` with a real stored run from `.test-data`.

### U03 [UX] [QA] Decompose and polish LiveClient
**Owns:** `components/LiveClient.tsx`, new `components/live/*`.
**Why:** 1,209-line client; Live is the daily-driver surface and has a history of drawer crashes and duplicate-key bugs.
**Do:** Split (usage strip / filters / session table / drawer). Polish: filter+sort state in URL query params so views are shareable/restorable; drawer keyboard support (Esc close, arrow next/prev session); explicit stale-data indicator when a poll fails (currently silent catch); "jump to transcript in Collection" link per session where a transcript path exists.
**Done when:** QA receipts on `/live` for ncode and codex harness params, drawer open/close, REDACT ON shows no raw usernames.

### U04 [STABILITY] Collection scan and FTS performance
**Owns:** `lib/collection/*`, `lib/live-cache.ts`, `app/api/collection/**` (all three route files), new `tests/collection-perf.test.ts`.
**Why:** Real machine has 700+ Codex sessions and 1,100+ timeline sessions; scans are the slowest surfaces and grow unboundedly with operator history.
**Do:** Profile the cold and warm scan paths; make incremental indexing the default (mtime/size cursors so unchanged files are never re-read); bound memory on large-file parses (stream, don't slurp, where not already); add a scan-budget escape hatch (time-box with honest partial-results flag surfaced in the API payload); ensure FTS rebuild is chunked and cancellable rather than one long write transaction (WAL writer starvation).
**Done when:** warm rescan with zero changed files does no full-file re-reads (prove with a counter in tests); cold scan of the `.test-data` corpus has a before/after timing note.

### U05 [STABILITY] SSE and polling lifecycle hardening
**Owns:** `lib/use-run-events.ts`, `lib/use-visibility-poll.ts`, `lib/use-debounced-value.ts`, `app/api/runs/[id]/events/**`, new `tests/sse-lifecycle.test.ts`.
**Why:** Long evaluations depend on the stream; past incidents include failed-poll runtime overlays. Reconnect behavior under dev-server restart and laptop sleep/wake is unproven.
**Do:** Client: exponential backoff with jitter on reconnect, `Last-Event-ID` resume verified end-to-end, visibility-aware pause/resume, and a surfaced connection-state value (hooks return it; consuming UIs already show polling state or can ignore it — do not edit client components other units own). Server: heartbeat cadence configurable, guaranteed stream close on terminal runs, replay window bounds documented in the route.
**Done when:** tests cover resume-after-drop, terminal-close, missing-run 404, and heartbeat; hook public API unchanged or strictly additive.

### U06 [STABILITY] SQLite durability and maintenance
**Owns:** `lib/db.ts`, `lib/config.ts`, new `app/api/settings/maintenance/route.ts`, new `tests/db-durability.test.ts`.
**Why:** All history lives in three SQLite DBs with WAL; there is no integrity check, no corruption story, and no maintenance path. A corrupt DB currently means a crash loop with no operator guidance.
**Do:** `PRAGMA integrity_check` (quick_check) on first open per process; on corruption, move the bad DB aside with a timestamped suffix, recreate schema, and surface a prominent one-time warning through an API-visible flag rather than crashing; schema_version table formalizing `migrate()`; maintenance endpoint (local-only, already behind Host middleware) exposing integrity check, `wal_checkpoint(TRUNCATE)`, `VACUUM`, and DB size stats; document the recovery behavior in `docs/architecture.md` **Storage** section only (append — U14 owns broader doc edits; coordinator note: this is the single sanctioned overlap, append-only, conflict-trivial).
**Done when:** tests prove a deliberately corrupted `.test-data` DB yields recovery-not-crash; maintenance endpoint returns stats and is rejected for non-local Hosts.

### U07 [STABILITY] Runner/executor edge hardening
**Owns:** `lib/executor.ts`, `lib/run.ts`, `lib/runner/*`, owner of `tests/executor.test.ts`, `tests/spawn.test.ts`, `tests/run-lifecycle.test.ts`; new `tests/executor-edges.test.ts`.
**Why:** Outcome honesty (error vs failed) is a core product claim; the untested edges are process-tree kills, mid-case crashes, and disk exhaustion.
**Do:** Verify and test: cancellation kills the whole child process tree (tmux and headless) with no orphaned harness processes; a runner crash mid-case persists partial output and terminal case state (no stranded `running` rows); ENOSPC/EIO during workdir prep or transcript write resolves to an honest `error` with the cause in `error_msg`; orphan sweep never flips a genuinely live run; workdir cleanup policy for terminal runs is explicit (keep-for-evidence vs prune) and documented in the case-detail artifact contract.
**Done when:** each edge above has a test; outcome precedence table in `tests/executor.test.ts` still passes untouched semantics.

### U08 [UX] [QA] Error, loading, and empty-state sweep
**Owns:** every `app/**/loading.tsx` and `app/**/not-found.tsx` (all new files — none exist today), all existing `app/**/error.tsx`, `components/EmptyState.tsx`, `components/ErrorBoundaryClient.tsx`, `components/ErrorHopper.tsx`.
**Why:** Heavy routes (Collection, Timeline, run detail) render nothing while server components fetch; missing ids fall through to the generic error boundary instead of a 404.
**Do:** Route-level `loading.tsx` skeletons for `/runs`, `/runs/[id]`, `/runs/[id]/case/[caseId]`, `/collection`, `/collection/timeline`, `/live`, `/cases`, `/accuracy`, `/harnesses` that mirror each page's real layout (no spinner-only screens); `not-found.tsx` for run/case/session id misses with links back to the listing; error boundary copy gains a "copy diagnostic details" affordance (digest + route); EmptyState variants gain a concrete next action everywhere (e.g. no runs → link `/runs/new` with the CLI one-liner as secondary).
**Done when:** throttled-network QA shows skeletons on all listed routes; bogus-id navigation shows 404 surfaces, not error boundaries.

### U09 [UX] [QA] Accessibility and keyboard pass on shared primitives
**Owns:** `components/Sidebar.tsx`, `SidebarNavClient.tsx`, `MobileNav.tsx`, `CommandPalette.tsx`, `ShortcutsOverlay.tsx`, `ToastProvider.tsx`, `StatusBadge.tsx`, `Section.tsx`, `PageHeader.tsx`, `ThemeToggle.tsx`, `RedactToggle.tsx`, `HarnessBadge.tsx`, `lib/use-global-key-handler.ts`, `lib/use-focus-slash.ts`, `lib/use-table-row-navigation.ts`, `lib/use-goto-navigation.ts`, `app/globals.css`, `tailwind.config.ts`, `app/layout.tsx`.
**Why:** Keyboard/AT support is unaudited outside video-contrast checks; the app is table- and drawer-heavy, which is where a11y usually breaks.
**Do:** Skip-to-content link; visible focus rings on the custom palette (both themes, WCAG AA); focus trap + restore in CommandPalette and ShortcutsOverlay; correct roles/labels on nav, badges (status conveyed by text not color alone), toasts (`aria-live=polite`); table row keyboard navigation announced properly; `prefers-reduced-motion` respected by any animation these primitives own; document the keyboard map in ShortcutsOverlay if gaps are found.
**Done when:** keyboard-only walkthrough (no pointer) can reach nav, palette, theme/redact toggles, and a table drilldown on `/runs`; axe or equivalent scan of `/` and `/runs` reports no serious violations in owned components.

### U10 [STABILITY] API validation and error-envelope consistency
**Owns:** `app/api/**` EXCEPT `collection/**` (U04), `runs/[id]/events/**` (U05), `settings/maintenance` (U06), `runs/route.ts` POST body (U11 — U10 may still normalize its error shape); new `lib/api-http.ts`; owner of `tests/api-routes.test.ts`.
**Why:** Body validation is strong (zod) but query params are hand-parsed per route; error JSON shapes vary; malformed query input should never 500.
**Do:** Introduce `lib/api-http.ts` with a shared `{ error, detail?, hint? }` envelope and zod query-param helpers; apply to owned routes (`cases`, `harnesses`, `harnesses/leaderboard`, `live`, `models`, `runs` GET, `runs/[id]` GET/cancel/report/telemetry/case, `settings` GET/POST); guarantee 400 for malformed params, 404 for missing ids, 500 only for genuine faults; every owned route gets a negative-input test.
**Done when:** grep shows no ad-hoc `NextResponse.json({ error` shapes left in owned routes; new negative tests pass.

### U11 [UX] [QA] New Run wizard clarity
**Owns:** `components/NewRunClient.tsx`, `components/HarnessPicker.tsx`, `components/ModelPicker.tsx`, `app/runs/new/*`, `app/api/runs/route.ts` (POST body validation + messages).
**Why:** The wizard is functional but front-loads every knob with little guidance; misconfiguration is discovered only after submission.
**Do:** Live selection summary ("N cases × M samples on <harness>/<model>, parallelism P") before launch; inline field-level validation mirroring the API's rules so the API 400 is a backstop, not the UX; disabled controls always carry a reason (title/tooltip + visible hint); unavailable harnesses shown with their probe failure rather than hidden; a "repeat last run" prefill from the most recent stored run; API 400s rendered inline next to the offending field.
**Done when:** deliberately invalid submissions never reach a bare error toast; QA receipts on `/runs/new` both themes/viewports.

### U12 [UX] [QA] Analysis surfaces polish and mobile (Collection, Timeline, Compare, Leaderboard)
**Owns:** `components/CollectionClient.tsx`, `TimelineClient.tsx`, `CompareClient.tsx`, `LeaderboardClient.tsx`, `CollectionCharts.tsx`, `OutcomeChart.tsx`, `Sparkline.tsx`, `ChartTooltip.tsx`, `markerKinds.tsx`.
**Why:** These four route clients are dense desktop tables/charts; mobile behavior and chart affordances lag the operator-dashboard bar set by Live/run detail.
**Do:** 390px-width audit and fix for all four routes (stacked rows, horizontally scrollable tables with sticky first column where stacking loses meaning); chart tooltips reachable by keyboard and touch (tap-to-pin); Collection search: debounced input with searching indicator, result counts, and preserved query in URL; Timeline: marker filter state in URL; Compare: empty/one-run states explain what to select; number formatting consistent with `lib/format.ts` everywhere (no raw floats).
**Done when:** QA receipts for all four routes at both viewports/themes, zero horizontal overflow, tooltips usable without hover.

### U13 [UX] [QA] First-run onboarding and Settings
**Owns:** `components/SettingsClient.tsx`, `components/OnboardingOverlay.tsx`, `components/RecentSessions.tsx`, `app/page.tsx`, `app/settings/*`, `app/api/settings/route.ts`.
**Why:** A brand-new operator with an empty `data/` and no harnesses lands on a dashboard of zeroes; the strongest funnel (install → first live insight → first run) is undesigned.
**Do:** Dashboard empty state becomes a 3-step guided path (detect harnesses → view Live sessions → launch first run) with live detection status per step; OnboardingOverlay reviewed for dismiss-persistence and re-entry from Settings; Settings groups options with plain-language descriptions and shows effective judge resolution (already surfaced) plus env-override warnings verbatim; add a Settings "diagnostics" block linking the U06 maintenance stats when present (read-only fetch, feature-detect the endpoint so units stay independent).
**Done when:** QA receipts with `OPENEVAL_DATA_ROOT` pointed at an empty temp dir (true first-run) and with `.test-data`.

### U14 [STABILITY] Dev-runtime doctor, CI, and batch bookkeeping
**Owns:** `package.json`, `scripts/doctor.ts` (new), `.github/workflows/*`, `CHANGELOG.md`, `docs/**` (except U06's Storage append), `docs/user-stories.md` ledger additions.
**Why:** The recurring local failure class is environmental: stale `.next` chunk caches breaking dev, hung dev servers, port collisions, `better-sqlite3` ABI mismatches after Node switches. These burn operator time and look like app bugs.
**Do:** `npm run doctor`: Node version vs `.nvmrc`, `better-sqlite3` loadability (rebuild hint), stale/incomplete `.next` detection with offer to clear, port 3000 occupancy report, `data/` DB quick_check (read-only), disk headroom; wire `doctor` into README troubleshooting; CI: add typecheck job if absent and cache node_modules; CHANGELOG "Unreleased" section seeded for this batch; extend the user-stories ledger with new story rows for U04/U05/U06/U07/U08 behaviors (status PENDING until integration evidence).
**Done when:** doctor runs clean on a healthy checkout and correctly flags a deliberately staled `.next`; CI config validates (`act` not required — YAML lint suffices).

---

## Coordinator protocol

**Waves (merge order, not start order — all 14 can start in parallel worktrees):**
- Wave A (lib-first): U01, U04, U05, U06, U07, U10
- Wave B (clients): U02, U03, U11, U12, U13
- Wave C (cross-cutting, rebase onto A+B before merge): U08, U09, U14

**Merging:** never resolve a conflict with `git checkout --ours` on a file the incoming branch hand-edited — that discards its work silently; cherry-pick the branch's commits or `git diff <src>^ <src> -- <file> | git apply -3`. After the train, grep each `[unit:UXX]` marker in `git log` to confirm nothing was dropped.

**Integration gates (after all merges, before reporting to operator):**
1. `npm test` (expect > 282, zero fail), `npm run typecheck`, `npm run lint`, `npm run build`
2. `npm run selftest` and `npm run audit:accuracy:strict`
3. `scripts/public-upload-audit.sh`
4. Browser sweep: all 16 documented routes (README route table), both themes, 1440×1000 + 390×844, zero console errors, zero horizontal overflow
5. Report per-unit receipts + integration receipts. **Do not push, PR, or tag without the operator typing approval.**

## Known failure classes (institutional memory — check your work against these)

- Stale/incomplete `.next` cache → missing chunk errors, hung dev server. Clear `.next`, restart; after `next build`, restart the dev server before browser QA.
- Tailwind opacity modifiers on CSS-variable colors silently don't emit unless tokens are RGB channels — verify computed styles when adding `bg-x/NN` utilities.
- React duplicate keys on session rows: key by transcript path, never sessionId+project.
- Object-shaped harness metadata reaching raw JSX children crashes clients — route values through the safe display boundary.
- Failed client polls must not surface Next runtime overlays — catch, abort on unmount, show stale-data state.
- Light theme regressions from hard-coded dark values — use theme-aware CSS variables; QA both themes always.
- Codex rollout JSONL files are large — never slurp entire session dirs without a recent-slice bound.

## Out of scope (explicitly)

- New eval cases / issue #24 (separate content workstream).
- New harness integrations, cloud/remote features, auth.
- Visual redesign — this batch polishes within the existing design language.
