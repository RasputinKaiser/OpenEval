# T001: Baseline and Acceptance

Task: `T001`
Kind: `pm`
Status: `current`

## Baseline

- Source baseline: `main` at OpenEval `v0.1.3`.
- Pre-existing dirty boundary: untracked `PLAN-UX-STABILITY.md`, `media/`, `videos/`, and `open-eval-under-1mb.jpg`.
- Baseline gates passed before this tranche: `npm test`, `npm run typecheck`, and `npm run lint`.
- Chrome baseline had no console warnings/errors and no page-level horizontal overflow at 1440x1000 or 390x844.
- Live closed state: 5,546 DOM nodes and 643 SVG elements for 100 mounted sessions.
- Live with one heavy drawer open: 18,308 DOM nodes, including 12,759 inside the dialog.
- Warm API samples: Live about 14ms median, Collection about 91ms median, Timeline about 19ms median.
- Active-trace churn produced compiled warm Live poll spikes up to 4.0s, proving that changed-file parsing can still enter the request path.
- Current visible formatting includes `10746.4M`, `~$13128.7825`, and `2746m2s`.
- Any tool or hook incident currently makes the whole session status pill `error`.
- Historical session age above 12h is called `stale`, which is easily confused with failed live polling.
- The Judge All status singleton is process-local even though verdicts are durable.
- On mobile, a fixed floating navigation button covers content.

## Acceptance

- Request-path scan refreshes are coalesced and can serve an honest last-good snapshot while refresh work continues.
- Live mounts a bounded session window and a bounded usage-detail representation by default.
- Live uses shared human-scale number, duration, and currency formatting.
- Terminal failure, recoverable tool/hook incidents, historical inactivity, and failed polling are visibly distinct.
- Judge All lifecycle/progress state survives module/process-style state reset and detects abandoned leases honestly.
- Mobile primary destinations are always visible without a floating content-obscuring control.
- Collection and Timeline can focus one task section without hiding data-quality warnings or active job progress.
- Focused tests plus full tests, typecheck, lint, build, public-upload audit, and representative browser QA pass before completion.

## Evidence

- Audit captures: `<local-visualization-dir>/openeval-ux-audit/`
- Strategy board: `openeval-phase-2-improvement-board.png` in the same directory.
