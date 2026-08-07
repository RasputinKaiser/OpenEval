# Changelog

All notable public changes to OpenEval are recorded here.

## [0.1.5] - 2026-08-07

Release hardening, bounded evidence delivery, durable judge jobs, and calmer onboarding.

### Install and release hygiene

- Documented the supported Node 20 and npm 10 toolchain, added a complete `.env.example`, and aligned the README, contributor guide, doctor checks, CI, and release commands around clean lockfile installs.
- Added `npm run verify:ci` and `npm run verify:release`, with the release gate covering typecheck, lint, tests, self-test, strict accuracy, public-upload scanning, and the optimized production build.
- Updated the dependency floor and lockfile to remove the known audit findings. Full dependency audit reports zero vulnerabilities.
- Extended the public-upload audit to the full candidate surface while preserving explicit review notes for intentional adversarial secret fixtures.

### Stability and evidence boundaries

- Judge jobs now persist their effective selection, fence stale leases, respect retry caps, and surface persistence failures instead of allowing old or missing workers to rewrite evidence.
- Transcript JSONL reads, artifact previews, artifact ranges, and report generation remain bounded or streamed; large records are disclosed as truncated rather than copied into unbounded payloads.
- Collection, report, artifact, cancel, and event-stream failures use consistent bounded JSON/SSE error envelopes.
- Visibility and live polling coalesce in-flight requests, while stale outcome judgments are invalidated when the source session revision changes.
- CLI runs without an explicit harness now resolve an available configured/default harness with an actionable error when none is installed.

### Product polish

- Improved judge-picker readiness, recovery, and retry states.
- Unified first-run onboarding and getting-started guidance without duplicate overlays.
- Refined Timeline evidence copy, review receipts, mixed-method explanations, adoption context, and denominator language.
- Reduced mobile navigation competition and improved narrow-screen New Run ordering, evidence grouping, and status recovery.
- Added focused regressions for judge persistence, bounded artifacts/transcripts, API envelopes, onboarding, support links, Timeline presentation, and mobile layout.

### Verification boundary

- `npm run verify:release` passed: typecheck, lint, full test suite, self-test (71 pass / 0 fail / 14 gated LLM-judge skips), strict accuracy audit, public-upload audit, and production build.
- The strict accuracy audit verifies 35/35 corpus, oracle, and known-bad checks while preserving `Unknown` for trace, visual, and LLM-judge evidence without corresponding runtime inputs.
- Production API smoke covered pages, Collection/Timeline data, report delivery, bounded artifact preview/ranges, event streaming, and consistent missing-resource errors.
- The release does not treat structural artifact receipts as pixel-quality proof, or deterministic fixtures as provider-backed harness success.

## [0.1.4] - 2026-07-31

Final evaluation-flow, observation-fidelity, responsive UX, and stability pass.

This release turns the previously separate benchmark, accuracy, observation, and evidence surfaces into one more coherent local-first evaluation workflow. It also adds a detailed four-level user-flow coverage tranche and makes the visible runtime release tag link directly to the corresponding GitHub release.

### Evaluate and benchmark authoring

- Added a shared Evaluate workflow across Runs, Leaderboard, Compare, Cases, New Run, and Accuracy, with consistent ordering, selected-state semantics, route-aware active states, and narrow-screen horizontal containment where the navigation is intentionally wider than the viewport.
- Reworked run diagnostics charts with explicit chart titles, numeric tick values, units, readable legends, accessible point labels, ranked throughput bars, and status distinctions that do not rely on color alone.
- Removed the misleading presentation of unavailable token or cost data as numeric zeroes. Missing, inferred, measured, and unavailable values remain distinguishable in tables, cards, charts, and reports.
- Added a watchable evaluation pulse for run detail with current case, next case, lifecycle phase, progress, timing, result state, connection status, recent activity, and direct evidence navigation.
- Added bounded visual comparison surfaces for SVG, HTML, pixel-art, 3D, isometric voxel, data-story, route-planner, poster, runbook, and related artifact outputs. Artifact identity, bytes, SHA-256, and viewport remain separate from pixel-quality judgment.
- Added low-usage creative benchmark coverage spanning 3D depth, pixel-art scenes, isometric voxel worlds, supplied-data SVG, accessible forms, data-story cards, route planning, Markdown runbooks, and other visual/code outputs.
- Reorganized New Run around a focused Core suite, Visual lab, Reasoning, and Everything presets. The wizard shows planned executions and budget implications before launch, while Everything is clearly marked as the highest-usage option.
- Added visible selected-case recovery in New Run. Cases selected outside the current filter remain listed, “Clear visible” is distinct from “Clear all,” and “Show selected” restores the hidden selection view.
- Added a Cases starter path for first-time operators, with a bounded Core-suite launch route and a Creative sampler path.
- Added explicit API-side validation for empty case selections, invalid harnesses, unavailable harnesses, malformed request values, bounded sample counts, and bounded parallelism.

### Accuracy, evidence, and evaluation truthfulness

- Expanded the runnable corpus to 35 cases across agentic SWE, reasoning, single-tool, and visual-code categories.
- Maintained 35/35 oracle coverage and 35/35 known-bad rejection coverage; the strict audit remains explicit about which trace, visual, and LLM-judge surfaces are still Unknown.
- Added structured evidence contracts for deterministic checks, trace checks, visual contracts, judge-backed evidence, and manual review without promoting one evidence tier into another.
- Accuracy now exposes evidence-loop actions, direct case/run links, weaknesses, uncertainties, judge posture, and empty-corpus recovery.
- Compare now surfaces pass-rate, throughput, visual-contract, and error deltas while preserving compatibility and missing-evidence boundaries.
- Added benchmark and user-flow manifests so product QA rows, evidence-lens rows, capability nuclei, and independently runnable benchmark cases cannot be confused in denominators.
- Added 250 UX stories covering sizing, visibility, contrast, color semantics, responsive density, interaction states, and evaluation/observation surfaces.
- Added 200 user-flow stories split evenly across brand-new, beginner, intermediate, and expert journeys. The 200-row tranche maps launch, discovery, evaluation, observation, configuration, recovery, and evidence-literacy paths while retaining a 20-row pending boundary for live or human proof.

### Live observation and data fidelity

- Preserved the semantic transcript/tool-call normalization pass for Codex, Claude, and ncode traces, including paired calls/results, bounded arguments/results, status, duration, tool names, and tool-search records.
- Kept raw transcripts authoritative while bounding derived payloads, transcript windows, FTS fields, DOM projections, and API response sizes.
- Added source-qualified session identity, parser-version cache invalidation, stale/partial scan disclosures, exact source inventory, and explicit discovered/scanned/parsed/dropped/unscanned populations.
- Collection and Timeline now distinguish signal, judged, heuristic, and no-signal populations, with outcome denominators and comparison windows shown rather than implied.
- Live and Collection retain measured/inferred/missing/malformed provenance for model, token, cost, duration, tools, and trace structure.
- Timeline refreshes coalesce safely, preserve the last good report through failures, expose retry/recovery state, and stop terminal or failed judge polling.
- Transcript search includes tool call IDs, status, duration, arguments, results, and bounded semantic text while avoiding raw message-body leakage in list payloads.
- Child traces and judge sessions remain attributable and are kept out of the wrong outcome denominators.

### Stability, security, and lifecycle behavior

- Hardened run cancellation and abort propagation through in-flight harness and grader work, with terminal state ordering and SSE stream closure made explicit.
- Added route-level loading, error, retry, and empty states across the major evaluation and observation routes.
- Added doctor checks for Node/runtime mismatch, native SQLite binding health, stale Next cache, port occupancy, database quick-check, and disk headroom.
- Kept harness discovery and launch diagnostics honest for missing binaries, failed probes, wrapper failures, revoked authentication, and unavailable providers.
- Hardened API mutation requests with local/same-origin checks, bounded query/body validation, stable error envelopes, and safe maintenance boundaries.
- Kept artifact and transcript access server-owned and symlink-safe, rejecting path traversal and out-of-source detail requests.
- Preserved redaction and public-upload checks so local databases, transcripts, usernames, private paths, and secret-shaped fixtures do not become release artifacts.
- Added hermetic launch and harness-gate tests so the test suite does not depend on a developer's current provider login state.

### Accessibility and responsive UX

- Added labeled dialogs, focus containment/restoration, Escape dismissal, visible close actions, and live status regions for onboarding, navigation, loading, errors, and run state.
- Improved keyboard focus rings, touch target sizing, native button semantics, pressed/current-page state, screen-reader lifecycle announcements, and non-color status cues.
- Rebalanced shell, card, table, chart, stat, session, and evidence layouts for desktop, tablet, and narrow viewports.
- Verified the primary evaluation routes at 390×844 with zero positive document overflow; intentional internal scrolling remains scoped to data-heavy controls.
- Preserved dark/light theme semantics and CSS-variable-safe color mixing rather than relying on unsupported Tailwind opacity expansion for raw color variables.

### Verification and proof boundary

- Full TypeScript typecheck, test suite, lint, production build, strict accuracy audit, doctor audit, public-upload audit, and diff hygiene checks pass for the release source.
- Post-build browser smoke covered Dashboard, Cases, New Run, Runs, Leaderboard, Compare, Accuracy, Live, Collection, and Timeline without a visible Next error page or browser console warnings/errors.
- This release does not claim fresh provider-backed success for every harness, pixel-quality truth from structural artifact receipts, full WCAG conformance, assistive-technology review, or human visual review. Those remain explicit Unknown/PENDING evidence states until exercised.

## [0.1.3] - 2026-07-27

Data-fidelity, proof-UX, accessibility, and measured performance release.

### Added

- `npm run doctor` — dev-runtime health checks for the recurring environmental failure classes that masquerade as app bugs: Node version vs `.nvmrc` and the `engines` floor, `better-sqlite3` native-binding loadability (with rebuild hint), stale or incomplete `.next` cache detection (`--fix` clears it), report-only port-3000 occupancy, strictly read-only `data/eval.db` `PRAGMA quick_check`, and disk headroom. `--json` emits machine-readable results.
- README Troubleshooting section mapping those failure classes to fixes.
- Lazy Live-session detail loading with explicit loading/error/retry states, keyboard focus trapping/restoration, and background scroll lock.
- Artifact byte receipts (`bytes`, SHA-256, modification time, and ETag) that remain explicitly separate from visual-quality proof.
- Collection data-fidelity reporting for parseable versus detect-only inventory and measured, inferred, missing, malformed, and stale session evidence.
- Explicit Live scan-population receipts: discovered, scanned, parsed, dropped, and unscanned file counts.

### Changed

- Live list/API transport now sends a lean row projection while retaining full trace, tool, queue, file, and usage details on demand; the measured 100-session payload is 93.5% smaller.
- Unknown transcript-source discovery is reused for 30 seconds while known-source fingerprints and content sentinels continue to revalidate on fresh scans.
- Dashboard observation failures remain visible as unavailable evidence instead of rendering as zero or empty history.
- Timeline refreshes now expose fresh/loading/stale/error states, preserve the last report on failure, offer retry, and stop terminal or failed judge polling.
- Timeline coverage and adoption rows now show exact signal/judged/no-signal counts and distinguish full comparison windows from the samples actually used by outcome medians.
- Run case rows use native button semantics with checkbox and re-run controls as siblings.

### Fixed

- Run confidence can no longer exceed 100% visual-contract coverage by counting nonvisual cases in the numerator.
- Declared expected artifacts are labeled as contracts, not as passed visual evidence; visual contracts now require at least one expected artifact.
- Evidence tiers are derived from the grader specification so stale persisted metadata cannot elevate proof strength.
- Accuracy and self-test gates now fail closed on malformed case files; strict accuracy also catches dangling oracle scripts and missing known-bad fixtures.
- Gemini CLI discovery counts only its verified `~/.gemini/tmp/**/logs.json` artifacts instead of treating unrelated JSON under `~/.gemini` as sessions; bounded detect-only scans visibly report depth/cap truncation.
- Live drawer and transcript requests resolve client-returned paths through the current server-owned source inventory, rejecting out-of-source and symlink-escape paths before parsing.
- `package-lock.json` now matches the package version.

### CI

- Cache the installed `node_modules` tree keyed on OS, Node major, and the lockfile hash, skipping `npm ci` (including the `better-sqlite3` native build) on unchanged lockfiles.
- Run `npm run doctor` as a smoke step.
- Run the strict accuracy release gate before the public-upload audit and production build.

## [0.1.0] - 2026-07-15

OpenEval's first tagged public release.

### Product

- Local-first, harness-agnostic evaluation dashboard for agent CLIs.
- Descriptor-driven Claude Code, Codex, ncode, and custom harness support.
- Repeatable evaluation cases with deterministic, trace, visual, LLM-judge, and manual evidence tiers.
- Live session intelligence with explicit measured, inferred, missing, and malformed provenance.
- Run history, leaderboard, comparisons, case inspection, telemetry, collection search, timeline analysis, and accuracy audits.
- Local SQLite persistence with private operator data excluded from public Git history.

### Reliability and public-readiness

- Hardened run lifecycle, grader behavior, request validation, redaction, and local Host checks.
- Expanded parser, middleware, API route, lifecycle, schema, and judge-backend test coverage.
- Public-upload auditing for local paths, tracked runtime data, identity boundaries, and secret-shaped fixtures.
- GitHub Actions CI, contribution guidance, issue templates, security policy, support guidance, and MIT licensing.

### Launch media

- Final 29.5-second OpenEval launch film with real dashboard footage and an integrated Right to Intelligence acknowledgment.
- Delivery master, poster, and 1280×640 GitHub/X social preview attached directly to the GitHub Release; production source stays outside the product repository.
- Explicit application and launch-film model credits in the README.

[Unreleased]: https://github.com/RasputinKaiser/OpenEval/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/RasputinKaiser/OpenEval/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/RasputinKaiser/OpenEval/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/RasputinKaiser/OpenEval/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/RasputinKaiser/OpenEval/releases/tag/v0.1.2
[0.1.1]: https://github.com/RasputinKaiser/OpenEval/releases/tag/v0.1.1
[0.1.0]: https://github.com/RasputinKaiser/OpenEval/releases/tag/v0.1.0
