# Combined Evaluate audit remediation

Scope: colorize, harden, adapt and polish for the three verified audit findings and adjacent controls. Original benchmark content, scoring and executor behavior are unchanged.

- Leaderboard rank numerals now use foreground/elevated-surface theme tokens, including forced-colors overrides; sorting controls have explicit focus rings and 44px targets.
- Parallel-worker and sample inputs reference stable help IDs and conditionally reference their current error IDs. Existing validation, alerts and submission guards remain intact.
- New Run filters, tag/selection actions and search use 44px minimum height. Runs filter/sort actions retain 44px on desktop as well as mobile; its search-clear button has a dedicated 44px target and reserved input space.
- Cases only offers clear-search recovery when a nonblank query exists and returns focus to search after clearing.

Full tests, initial typecheck and the mechanical detector passed. Final production and browser receipts are recorded below and in state.yaml.

## Verification receipt

Full tests, production build, lint, post-build typecheck, detector and diff checks passed. No inference or publication was initiated.

Production browser measurements:
- Rank fg/bg: dark rgb(232,232,234)/rgb(22,22,26), contrast 14.75:1; light rgb(26,26,31)/rgb(236,236,240), contrast 14.71:1. Opaque token backgrounds retain contrast across row hover states.
- Invalid parallel=9 and samples=0 referenced the correct help and error IDs with existing text. Correcting both to 1 removed error references, set aria-invalid=false and enabled Start Run. It was not clicked.
- At 390px viewport, New Run difficulty buttons measured 44px; document scroll width 379px. Fresh narrow light screenshot confirmed wrapping and layout.
- Runs clear-search target measured 44x44px. Enter cleared the query from the URL.
- Leaderboard sort controls measured at least 44x44px (one wrapped label was 60px tall); Enter on Runs changed its accessible label to sorted descending.
- Unknown case category showed recovery to the cases page with no empty clear-search action.
- Desktop dark theme restored; local preview remains on /cases.

All three original audit findings are closed by these targeted checks. This is not exhaustive WCAG certification or real-device Safari/Android validation.
