# Evidence Room: receipt rail + full audit canvas

Date: 2026-08-03

Status: implemented; parent verification complete except production build

## Decision

OpenEval’s evidence surfaces will use the B + C direction:

- B’s persistent evidence rail provides orientation and makes retained evidence discoverable.
- C’s full audit canvas keeps caveats, adoption scope, judge receipts, and raw-output availability in the main reading flow.
- The first viewport leads with the selected outcome and its honest comparable denominator. Operational state remains visible but no longer pushes the interpretation below the fold.
- On narrow screens, the rail transforms into a compact horizontal evidence strip or disclosure drawer. It must remain keyboard reachable and must not create positive document overflow.

The rail is navigation and orientation, not a second dashboard. The main canvas is where the user interprets the evidence.

## Evidence contract

OpenEval keeps two related but distinct views:

1. **Score view** contains only the current comparable population. Current prompt/version rules continue to determine the score denominator and outcome series. Mixed or stale receipts must not silently change that denominator.
2. **Receipt view** retains every source-qualified judgment receipt that can be matched to the current top-level session population. It exposes backend, model, reasoning effort, prompt version, comparability, and stale/legacy state.

The UI must label both counts wherever they appear, for example `2 comparable` versus `4 retained receipts`. A stale receipt is evidence about what happened, not a current comparable score.

The narrow implementation does not require a database migration. Existing judgment selection and prompt-version fields are reused; any derived receipt projection must be bounded to the current report/session population and must preserve partial, unavailable, and inferred states.

## Surface hierarchy

### Timeline / Observe

- Compact evidence rail: timeline, receipts, judge, raw output, and support.
- Main header: freshness, suite/population, judge readiness, and explicit stale/mixed indicators.
- Outcome trend and comparable denominator before the long operational receipt blocks.
- Adoption scope immediately after the selected outcome context.
- Receipt details retain current and stale rows with explicit status and provenance.
- Existing progressive section navigation, deep links, filters, and accessible names remain stable.

### Collection

- Keep one coherent Find a session path rather than splitting global search from the selected-session surface.
- Make source/population coverage and caveats legible without hiding the corpus behind a large warning stack.
- Use the rail/strip for collection sections and evidence categories, preserving source-qualified session links and query parameters.
- Keep transcript and archive states explicit; absence of a source file is not presented as a successful transcript read.

## Non-goals

- No redesign of the underlying collection resolver or transcript cursor contract.
- No prompt-version migration or rewriting of historical judgment rows.
- No causal claim from an improved visual hierarchy.
- No commit, push, release, or public-upload action as part of this slice.

## Verification

The parent integration pass owns the shared contract and release proof. It will run focused evidence tests first, then `npm test`, `npm run typecheck`, `npm run lint`, `npm run audit:accuracy:strict`, `git diff --check`, and a fresh browser check after starting the configured preview. Existing dirty-worktree changes and any blocked build/browser proof remain visible in the final handoff.
