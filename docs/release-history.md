# Earlier release highlights

Historical snapshots; use the [current installation guide](getting-started.md) for supported runtime versions.

## What's New in v0.1.6

OpenEval v0.1.6 is the dashboard-visualization and outcome-evidence release: a verdict-first Dashboard, new per-session and per-token visualizations, an upgraded deterministic judge contract, and expansive model tagging across every harness.

### A verdict-first Dashboard

- The Dashboard opens with a composite verdict: outcome trend with baseline, health score, and the primary actions, so the first screen answers "how is my agent doing?" before any table.
- The new Token-economy panel reports cache hit rate, fresh-token volume, API-equivalent spend efficiency per 1M tokens, and a cache/input/output composition bar — the money story under the usage numbers.
- Sources, Tooling, and Models panels break the aggregate KPIs into per-harness bars, evidence provenance, and per-model token share, with unavailable states that read as "unread," not "empty."

### Cost-versus-outcome evidence on the Timeline

- A new cost-vs-outcome scatter plots every session's cost on a log scale against its deterministic outcome score, with judge-reviewed sessions highlighted over heuristic ones and honest coverage denominators.
- Adoption impact rows now carry effect-size strength badges (standardized mean difference) and comparability tags (thin, mixed-provenance, child-only), so a delta's reliability is visible next to its size.
- Review evidence exposes stale receipts: verdicts saved under an older prompt contract are counted, explained, and excluded from comparable scores until re-reviewed.

### Deterministic judge v3

- Scoring anchors are explicit: 1.0/0.5/0.0 each name their required evidence, and intermediate scores are reserved for evidence that straddles anchors.
- The judge receives the heuristic pre-scan flags and must confirm or refute each in its reasons, grounding every verdict in checkable claims.
- Single-turn sessions are judged on whether the final answer serves the opening request, without penalizing missing follow-up.
- Prompt-version mixing is fenced: verdicts under an older contract never confer judged provenance, and the next pass re-judges them automatically.

### Model tagging for any harness, any model

- A new pure taxonomy module infers provider (15 providers plus local runtimes), family, and display label for any model id — pattern-based, no stale lookup table.
- Family grouping collapses date-stamped, org-qualified, and quantization-tagged variants under one canonical identity.
- Live model rows show provider chips with family tooltips.

### Deeper observation and craft

- Transcript mining is hardened with per-record guards in every parser and ENOENT-safe directory mining; malformed records no longer drop whole sessions.
- A 30-day activity strip, beeswarm session-cost footprint with log-scale decade gridlines and median marker, evidence-density strips, and a diverging delta chart join the chart library.
- Reduced-motion parity, focus contracts (drawer modal, chart SVG), hover-geometry fixes, and a View-Transitions drawer morph polish every interaction.
- Primary routes verified at 320–1920px with zero horizontal overflow; 18/18 contrast pairs pass AA in both themes.

Tests: 779/779 · TypeScript 0 errors · lint 0 warnings · detector 0 findings.

[Read the complete v0.1.6 release notes](https://github.com/RasputinKaiser/OpenEval/releases/tag/v0.1.6) · [Compare v0.1.5...v0.1.6](https://github.com/RasputinKaiser/OpenEval/compare/v0.1.5...v0.1.6)

## What's New in v0.1.5

OpenEval v0.1.5 is the release-hardening pass: clean installs are documented and gated, evidence delivery is bounded, judge jobs are durable, API recovery is more consistent, and the dense observation surfaces are easier to read on desktop and mobile.

### Safer installation and release checks

- Supported Node 20 and npm 10 versions are explicit in the package engines, `.nvmrc`, doctor output, README, and contributor guide.
- `.env.example` documents data roots, harness defaults, judge settings, host allowlists, scan budgets, and transcript streaming controls.
- `npm run verify:ci` and `npm run verify:release` provide one repeatable validation path from clean install through production build.
- The full dependency audit is clean, and the candidate-scope public-upload audit checks tracked and untracked release material for local paths, identities, and secret-like leakage.

### More durable evidence

- Judge selections and lease ownership are persisted and fenced, so a stale or interrupted worker cannot silently replace current evidence.
- Transcript records, artifact previews, byte ranges, and report bundles stay bounded or stream from disk with explicit truncation, range, hash, and provenance metadata.
- Collection, report, artifact, cancel, and event-stream failures share readable JSON/SSE recovery envelopes.
- Polling coalesces duplicate requests, and source revisions invalidate stale outcome judgments instead of displaying old scores as current.

### Easier to operate

- Harness selection falls back to an available configured harness when no explicit harness is supplied and gives a concrete install/configuration error when none is available.
- Onboarding, judge setup, retry/readiness states, review receipts, mixed-method explanations, Timeline copy, and evidence denominators are clearer.
- Mobile navigation, New Run ordering, evidence grouping, and compact status/recovery surfaces are less crowded.

The release gate verifies deterministic and corpus-backed evidence while preserving `Unknown` for trace, visual, LLM-judge, provider, assistive-technology, and human-review surfaces that were not exercised by the corresponding runtime proof.

[Read the complete v0.1.5 release notes](https://github.com/RasputinKaiser/OpenEval/releases/tag/v0.1.5) · [Compare v0.1.4...v0.1.5](https://github.com/RasputinKaiser/OpenEval/compare/v0.1.4...v0.1.5)

## What's New in v0.1.4

OpenEval v0.1.4 is the broad stability and evaluation-flow release. It ties the Evaluate pages together, makes benchmark evidence easier to watch and compare, preserves the strong local observation surfaces, and adds explicit boundaries wherever the local product does not yet have provider or human proof.

### A more coherent evaluation workflow

- Runs, Leaderboard, Compare, Cases, New Run, and Accuracy now read as one ordered Evaluate workflow instead of isolated pages.
- Run diagnostics use explicit chart titles, numeric ticks, units, accessible point labels, ranked throughput bars, and honest measured/estimated/missing cost treatment.
- Run detail has a watchable evaluation pulse with current/next case, lifecycle phase, progress, timing, connection state, bounded replay, and direct evidence navigation.
- Compare surfaces A/B pass-rate, throughput, visual-contract, and error deltas, plus bounded side-by-side visual artifact review.
- New Run begins with a focused Core suite and provides Visual lab, Reasoning, and Everything presets with planned execution and budget visibility.
- Cases provides a direct Core-suite starter path and a Creative sampler route for operators who do not yet know which benchmark to choose.
- Selected cases that disappear under a filter remain visible and recoverable; “Clear visible,” “Clear all,” and “Show selected” have distinct meanings.

### A wider, more useful benchmark library

- The runnable corpus now contains 35 cases across agentic SWE, reasoning, single-tool, and visual-code work.
- Visual/code coverage includes supplied-data SVG, pixel art, 3D depth, isometric voxel worlds, data-story cards, route planners, accessible forms, dashboards, posters, diagrams, sortable tables, responsive layouts, and Markdown runbooks.
- The catalog keeps deterministic structural checks separate from screenshot, pixel-quality, judge, and human review. Bytes, hashes, selectors, and element counts are evidence receipts, not visual-quality verdicts.
- The ledger now includes 200 user-flow stories across brand-new, beginner, intermediate, and expert journeys, plus a 250-row UX pass covering sizing, visibility, contrast, color, responsive density, and interaction states.

### Stronger accuracy and evidence posture

- The strict corpus audit covers 35/35 oracle scripts and 35/35 known-bad scripts.
- Accuracy surfaces expose evidence tiers, weaknesses, uncertainties, direct next actions, judge posture, and the distinction between configuration-only and executed proof.
- Product-flow coverage, capability nuclei, evidence-lens rows, and runnable benchmark cases have separate manifests and denominators.
- Unknown and pending states remain visible for unexercised provider, trace, visual, LLM-judge, assistive, and human-review evidence.

### Observation remains the deepest surface

- Live, Collection, and Timeline retain bounded semantic transcript and tool-call views for Codex, Claude, ncode, and other configured sources.
- Tool calls/results are paired by identity where available, with names, status, duration, bounded arguments/results, and tool-search records.
- Raw transcripts remain authoritative; derived windows, FTS fields, DOM projections, and API payloads stay bounded.
- Collection and Timeline report discovered, scanned, parsed, dropped, unscanned, signal, judged, heuristic, and no-signal populations explicitly.
- Measured, inferred, missing, malformed, stale, archived, and incomplete provenance remains visible for model, token, cost, duration, tools, and trace structure.
- Child traces and judge sessions retain lineage and stay out of unrelated outcome denominators.

### Stability, accessibility, and responsive behavior

- Run cancellation now propagates through in-flight harness/grader work and closes terminal SSE streams honestly.
- Loading, error, retry, and empty states are present across the primary evaluation and observation routes.
- Onboarding is session-aware, route-aware, focus-contained, Escape-dismissible, and labeled for assistive technology.
- Harness discovery reports failed probes, missing binaries, wrapper failures, and revoked authentication with a concrete recovery action.
- API requests are bounded and field-tagged; mutation routes enforce local/same-origin safety; artifact access is server-owned and symlink-safe.
- The sidebar release tag now comes from package metadata and links directly to the matching GitHub release tag.
- Primary evaluation routes were checked at 390×844 with zero positive document overflow and no captured browser console warnings/errors.

### Release proof

The release source passed TypeScript typecheck, the full test suite, lint, production build, strict accuracy audit, doctor, public-upload audit, and diff hygiene checks. The release deliberately does not claim every harness has fresh authenticated provider success, that artifact structure proves pixel quality, or that source/browser checks replace full assistive-technology and human visual review.

[Read the complete v0.1.4 release notes](https://github.com/RasputinKaiser/OpenEval/releases/tag/v0.1.4) · [Compare v0.1.3...v0.1.4](https://github.com/RasputinKaiser/OpenEval/compare/v0.1.3...v0.1.4)

## What's New in v0.1.3

OpenEval v0.1.3 makes large local transcript collections faster to inspect and much harder to misread:

- **93.5% smaller Live list payload:** the measured 100-session response fell from 2.65 MB to 171 KB, while full trace, tool, queue, file, and usage detail remains available on demand.
- **Exact source inventory:** Gemini discovery now counts verified `~/.gemini/tmp/**/logs.json` artifacts instead of unrelated configuration JSON; same-machine known-source discovery improved from 60 ms to 26 ms median.
- **Visible data fidelity:** Collection separates parseable and detect-only files and reports measured, inferred, missing, malformed, stale, archived, and incomplete evidence explicitly.
- **Honest populations:** Live shows discovered, scanned, parsed, dropped, and unscanned files; Timeline distinguishes signal, judged, heuristic, and no-signal sessions and displays the actual outcome denominator.
- **Stronger proof UX:** artifact byte receipts, visual-contract boundaries, strict accuracy gates, accessible case rows and session drawers, and resilient loading/error states make evidence easier to audit.

[Read the v0.1.3 release notes](https://github.com/RasputinKaiser/OpenEval/releases/tag/v0.1.3) · [Compare v0.1.2...v0.1.3](https://github.com/RasputinKaiser/OpenEval/compare/v0.1.2...v0.1.3)

