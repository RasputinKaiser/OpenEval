# Optimization and installation pass

Baseline: fae9070 on codex/app-refinement-evidence with substantial existing uncommitted application work retained.

## Implemented

- `npm run setup`: dependency-free Node entrypoint; Node 22/npm 10 checks, locked install, in-memory SQLite verification and production build. Explicit check-only, development and skip-install modes; errors retain command output.
- `npm run open`: existing production build on loopback, validated custom port, useful missing-build recovery, signal forwarding and nonzero process failure propagation.
- README quick start appears before release history; detailed first-run, update and troubleshooting guide; no account/API key required for transcript observation. Paid evaluations are explicitly optional in first-run guidance.
- `.nvmrc`, package engine metadata and CI runtime selection aligned with Node 22; doctor now respects the upper engine bound too.
- Analysis cache holds at most eight bounded pages per immutable snapshot, with generation, selection, page and status metadata in the invalidation contract. HTTP responses remain private/no-store.

## Measurement

Identical synthetic 12,000-session, 60-request alternating-selection workload, three process measurements per variant: median 10.540s -> 1.022s (-90.3%). Exact report outputs are covered by parity tests. This is repeated-server-computation evidence, not a claim about first-load scanning, cold build time or browser interaction latency. See `.optimize/ledger.md` and `scripts/perf/repeated-analysis.ts`.

## Validation

Final verification passed:
- Clean temporary install through `npm run setup -- --no-build`, with no preexisting node_modules; native SQLite check passed. Patched install reports zero audit vulnerabilities.
- Main checkout install from the same lockfile also reports zero vulnerabilities.
- Production build through `OPENEVAL_BUILD_DIR=.next-interactive npm run setup -- --skip-install` passed on Next.js 15.5.25. The earlier 15.5.23 build was deliberately stopped before installing the security patches.
- Full test suite passed on the patched dependencies; focused setup/analysis/doctor suite passed 32/32; final standalone typecheck and lint passed. ESLint emits its existing Next CLI deprecation notice, with no lint warnings/errors.
- Deterministic selftest: 71 passed, 14 optional LLM-judge checks skipped. Strict accuracy audit passed while retaining unknown trace/visual/judge surfaces. These checks do not claim paid-provider or human visual validation.
- Public-upload audit and diff check passed.
- `npm run open -- --port 3177` started the production server on loopback. A second launcher on the occupied port returned exit 1/EADDRINUSE without stopping the running app.
- Computer Use: production Collection rendered with no document overflow; gpt-5.5 inspection showed 446 matching sessions; Explore retained vizModel in the URL and loaded 80 of 446 rows. A source-qualified link reached a rendered conversation. The tab was left at Collection/Models.

Platform coverage: installation and browser smoke tested on macOS/Node 22.22.3/npm 10.9.8. CI is configured to follow .nvmrc, but no remote Linux CI run or native Windows test was performed in this local pass. First-run guidance copy is covered by the existing suite; a completely empty-home browser environment was not exercised.

The patched clean install passed and reported zero npm audit vulnerabilities. Next.js is locked at 15.5.25; sharp, adm-zip, browserslist, js-yaml and other affected transitive packages were updated within compatible ranges. No forced major upgrade was used.
