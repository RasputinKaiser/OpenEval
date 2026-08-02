# OpenEval Phase 2 Deep Pass

## Objective

Implement the highest-leverage Phase 2 improvements identified by the live UX/performance/stability audit: move expensive work away from request paths, reduce Live rendering cost, make status and numeric signals trustworthy, persist long-running judge work, and improve the mobile/task-oriented shell.

## Goal Kind

`specific`

## Current Tranche

Complete one reviewable local implementation tranche across four disjoint Luna/xhigh lanes, integrate it on `main`, and close with focused tests, the full OpenEval verification suite, production build, and representative desktop/mobile browser QA. Leave larger architectural follow-ups as explicit receipts rather than widening scope silently.

## Non-Negotiable Constraints

- Preserve the existing untracked `PLAN-UX-STABILITY.md`, `media/`, `videos/`, and `open-eval-under-1mb.jpg`.
- Never read or mutate real operator data for tests; use `.test-data` or isolated temporary roots.
- Preserve redaction-on defaults and measured/inferred/missing provenance.
- Preserve server-owned Live path validation and symlink-escape rejection.
- Do not change parser output without updating the parser cache contract and its tests.
- Do not build while a Next.js development server is running.
- Do not push, publish, tag, or open a pull request in this tranche.
- The PM owns integration, final verification, and all board state.

## Stop Rule

Stop when the tranche audit passes, every safe in-scope change is integrated and verified, or continuing would require destructive work, credentials, external writes, or product strategy outside this charter.

## Canonical Board

Machine truth lives at:

`docs/goals/openeval-phase-2-deep-pass/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins for task status, active task, receipts, verification freshness, and completion truth.

## Run Command

```text
/goal Follow docs/goals/openeval-phase-2-deep-pass/goal.md
```

## PM Loop

1. Read this charter and `state.yaml`.
2. Work only under the active PM integration task.
3. Keep every delegated write lane inside its exclusive file set.
4. Collect a compact receipt from every Scout, Worker, and Judge.
5. Integrate and resolve cross-lane contracts at the PM level.
6. Run focused and full verification.
7. Finish with an independent Judge audit and update the board.
