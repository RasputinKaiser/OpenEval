# Evaluate technical audit — 2026-09-12

Implementation integrity: PASS. The sampled implementation expresses OpenEval's existing analytical system: evidence-aware comparisons, separate missing cost coverage, native disclosures, theme tokens and source-derived case contracts. This is not a claim of complete accessibility conformance.

Scope: source review of Cases, shared Evaluate navigation, New Run, Leaderboard, Compare, Runs and artifact previews. Production browser checks concentrated on Cases, New Run and Leaderboard. Desktop dark/light and 390px narrow layout were inspected. This is a technical UI audit; no paid provider run, executor benchmark, exhaustive assistive-technology matrix or performance benchmark was performed.

| Dimension | Score | Basis |
| --- | --- | --- |
| Accessibility | 2/4 | Verified rank contrast failure; numeric error association gap |
| Performance | 3/4 | Debounced search, bounded retained runs and controlled preview loading; no runtime performance benchmark |
| Responsive design | 3/4 | Cases/New Run have no page overflow at 390px; some New Run targets are 40px |
| Theming | 3/4 | Core tokens and both themes work; rank colors remain hard-coded |
| Implementation integrity | 3/4 | Coherent source-based contracts; isolated control/token drift |
| Total | 14/20 | Good — address weak dimensions |

## Findings

### P1 — Leaderboard rank numerals fail light-theme contrast
Location: components/LeaderboardClient.tsx:432. Accessibility / Theming.

Browser computed colors: rank 1 rgb(250,204,21) over rgba(234,179,8,.15); rank 2 rgb(209,213,219) over rgba(156,163,175,.15); rank 3 rgb(217,119,6) over rgba(180,83,9,.15). The underlying card is color(srgb .966824 .966824 .974196); the first row additionally has rgba(26,127,55,.05). Compositing these backgrounds gives approximate text contrast of 1.23:1, 1.23:1, 2.43:1. All are below 4.5:1 for small text (WCAG 1.4.3). These numerals convey rank and are not decorative.

Recommendation: use theme-aware rank foreground tokens or ordinary foreground text with a separate colored marker. Verify hover and both themes. Suggested command: impeccable colorize.

### P2 — Numeric validation messages are not associated with inputs
Location: components/NewRunClient.tsx:394 and the adjacent samples input. Accessibility.

Entering parallelism 9 sets aria-invalid=true, renders an alert, and disables Start Run correctly. Runtime DOM confirms aria-describedby is absent on both numeric inputs. Returning keyboard/assistive-technology focus to an invalid input does not expose the nearby message through an explicit description relationship.

Recommendation: give help/error messages stable IDs and reference them from aria-describedby, preserving existing alert behavior and submission guards. Suggested command: impeccable harden. This audit does not claim that every assistive technology fails to announce the existing alert.

### P2 — New Run filters miss the 44px touch-target standard
Location: components/NewRunClient.tsx:541; similar min-h-10 selection controls elsewhere in the component. Responsive design.

At a 390px viewport, easy/medium/hard buttons measure 40px high. This is below the project's 44px interaction target and the skill's touch criterion. It is not by itself a WCAG 2.2 AA 24px target-size failure.

Recommendation: consistently use at least 44px for filter and selection actions, preserving wrapping. Suggested command: impeccable adapt.

## Positive evidence

- At 390px, Cases and New Run document scroll width was 379px: no page-level horizontal overflow in the sampled states.
- Shared Evaluate links measured 54px or 70px tall, with wrapping descriptions.
- Case cards computed box-shadow:none in light mode; borders carry elevation.
- Reduced-motion emulation produced 0s disclosure-chevron transition.
- Enter opened the case grading contract and retained visible focus.
- Suite composition correctly displayed '1 case' after filtering.
- Invalid parallelism was blocked before run submission; no evaluation was started.
- The one mechanical detector scan returned no findings in changed TSX targets. That result does not cover unscanned files or replace the contrast measurement.
- Full tests, production build, lint, post-build typecheck and diff check passed for the preceding polish edits.

## Recommended sequence

1. impeccable colorize: theme-aware leaderboard rank text.
2. impeccable harden: associate numeric help/errors with inputs.
3. impeccable adapt: normalize New Run touch targets.
4. impeccable polish: confirm the repaired path in both themes and narrow layout.

No fixes were applied as part of this audit. The already-authorized polish pass was completed separately. Performance scores are review judgments, not measured speed claims. Preview restored to desktop dark mode.

## Remediation follow-up

All three findings above were subsequently fixed and verified in the combined pass. See evaluate-audit-remediation.md for measured contrast (14.75:1 dark / 14.71:1 light), numeric error linkage and recovery, and 44px controls. The original score is retained as the historical audit baseline, not a new post-fix rating.
