# Changelog

All notable public changes to OpenEval are recorded here.

## [Unreleased]

Seeded for the PLAN-UX-STABILITY batch; entries from the batch's units land here as they integrate.

### Added

- `npm run doctor` — dev-runtime health checks for the recurring environmental failure classes that masquerade as app bugs: Node version vs `.nvmrc` and the `engines` floor, `better-sqlite3` native-binding loadability (with rebuild hint), stale or incomplete `.next` cache detection (`--fix` clears it), report-only port-3000 occupancy, strictly read-only `data/eval.db` `PRAGMA quick_check`, and disk headroom. `--json` emits machine-readable results.
- README Troubleshooting section mapping those failure classes to fixes.

### CI

- Cache the installed `node_modules` tree keyed on OS, Node major, and the lockfile hash, skipping `npm ci` (including the `better-sqlite3` native build) on unchanged lockfiles.
- Run `npm run doctor` as a smoke step.

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

[0.1.0]: https://github.com/RasputinKaiser/OpenEval/releases/tag/v0.1.0
