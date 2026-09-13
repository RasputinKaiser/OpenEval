# Interactive successors for existing evaluations

Added `visual-map-route-planner-v2` and `visual-data-story-card-v2`. Original cases, prompts and historical identities remain unchanged. New Run offers an Interactive tools preset; both references appear first in `/cases/playground` and link to their own case selections.

## Route planner
Responsive connected map with numbered landmark controls, current-position state, progress, next action, Next/Reset and a user-started tour. Deterministic checks exercise selection, stepping, clamping at Finish, completion, reset and invalid-index rejection. A static placeholder and an overrun-at-Finish implementation are negative fixtures.

## Outcome story
Fixed baseline/current cohort data; four selectable metrics, paired bars on a labeled shared scale, exact values, denominators and methodology. Baseline cost is unavailable and has no bar or computed change. Percentage-point changes are distinguished from relative percentages; lower latency and cost directions are explicit. Estimates are not spend; observed change is not causation. Checks exercise all metrics, missing cost, reset and invalid selection. Negative fixtures include a plausible UI whose state incorrectly turns missing cost into zero.

These deterministic checks verify the declared state contract, not all UI behavior or visual quality. Reference demos remain distinct from actual agent outputs. No paid run was started.

Validation: playground checks 7/7 passed. Full suite, selftest, strict accuracy, build and browser receipts follow below after completion.

Final verification: full tests, strict accuracy, public-upload audit, production build with lint, post-build typecheck and diff check passed. Selftest: 83 pass, 0 fail, 14 optional LLM-judge skips. Browser verified route Next updates current/next labels, guided tour stops at Finish, cost displays Unavailable with no computed change, and latency displays 4.8s to 3.1s with -1.7s. At a requested 390px viewport (433 CSS pixels with existing zoom), the page had no overflow; the data-story iframe body measured 340px client/scroll width and all four metric buttons measured 44px high. Build this challenge selected exactly the v2 data-story case. No provider run started; references are not claimed as agent results.
