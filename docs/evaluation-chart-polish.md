# Evaluation and chart polish

Scope: existing dirty checkout, local delivery. Shared chart improvements preserve the established visual theme and existing source/evidence navigation.

## Changes
- Compare shows paired A/B metrics directly, retaining its exact delta data table and metric URL restoration.
- Paired values now reveal exact labels and values on pointer hover or keyboard focus; click pins the existing inspection with an explicit Clear action. Missing values remain unplotted.
- Distributions reveal inclusive/exclusive boundaries and exact counts on hover/focus. Bins retain 40px minimum widths with local horizontal scrolling instead of becoming tiny targets.
- Runs shows interactive status bars directly rather than hiding them behind advanced details; explicit Explore selects matching case/sample pairs.
- Shared selected bars gain an inset selection accent. Paired/distribution hover transitions affect appearance only, preserve value geometry and honor reduced motion.
- Case admission rejects nonfinite/negative weights and thresholds outside 0–1. Evaluation rejects invalid direct inputs and cannot pass empty, all-zero-weight or infrastructure-failed evidence.
- The executor previously overrode a met weighted threshold whenever any ordinary grader failed. It now evaluates ordinary grader evidence against the configured threshold, retaining real failures ahead of concurrent infrastructure errors and retaining infrastructure errors ahead of passes.

## Review and verification
Reviewed run creation validation, grader aggregation, executor status precedence, judge selection/verdict validation, and existing chart keyboard/pinning foundations in Collection, time series and outcomes. No account connections or provider inference were started.

The first full suite exposed an existing assertion that infrastructure-failed evaluation could report passed while final status was error. That assertion now requires false, retaining error status. A new executor fixture proves 90% weighted evidence passes an 80% threshold. Grader/executor checks: 49 passed. Corrected full suite passed. Deterministic selftest: 71 pass, 0 fail, 14 optional LLM-judge skips. Strict accuracy passed. Build and browser verification recorded after completion below.

Final production build (including lint) and post-build typecheck passed. Browser QA confirmed Leaderboard pin → Explore → retained run; visible run-status pin → matching-case Explore; histogram keyboard boundary tooltips; 40px histogram bins with no narrow page overflow; direct Compare paired controls, keyboard pin/clear and exact case/sample URL navigation. Narrow paired rows measured 64px; unavailable A-side had no marker; reduced-motion transitions measured 0s. Accuracy, Cases and New Run rendered, with setup readiness gating retained. No new run was launched. This is desktop browser/emulated narrow-layout evidence, not physical touch-device or provider-inference verification.
