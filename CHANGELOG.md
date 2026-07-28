# Changelog

All notable public changes to OpenEval are recorded here.

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

[Unreleased]: https://github.com/RasputinKaiser/OpenEval/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/RasputinKaiser/OpenEval/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/RasputinKaiser/OpenEval/releases/tag/v0.1.2
[0.1.1]: https://github.com/RasputinKaiser/OpenEval/releases/tag/v0.1.1
[0.1.0]: https://github.com/RasputinKaiser/OpenEval/releases/tag/v0.1.0
