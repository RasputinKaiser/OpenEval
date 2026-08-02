# T001 Final Receipt

## Integrated lanes

- Collection snapshots: coalesced last-good background refresh, honest stale/error metadata, atomic aggregate/session fingerprint boundary, bounded one-shot scan isolation, and bounded 80-row SSR with cursor continuation.
- Live rendering and signals: 50-row progressive window, 120-point drawer usage decimation, exact public-payload polling signature, complete row freshness, human-scale formatting, and distinct terminal/incident/inactivity/poll states.
- Judge jobs: durable SQLite job state, conditional leases and heartbeats, restart interruption/resumption, persisted progress/error status, and one-job claiming.
- Mobile/task IA: persistent safe-area primary navigation, accessible More dialog/focus restoration, one-panel progressive disclosure with URL/history restoration, and scroll-to-selected behavior.

## Review fixes

The independent mid-tranche Judge found and the PM fixed:

- Live expansion resetting on polls.
- Live row/signature fields remaining stale.
- Nested interactive controls in Live rows.
- Mobile selected panels not scrolling into view or following browser history.
- Snapshot stale/backoff and client metadata truth gaps.
- Aggregate/rollup corpus mismatch risk.
- Explicit bounded scans coalescing into unrelated unbounded work.
- Timeline dropping Collection refresh failures.
- Collection rendering all 1,397 sessions after the snapshot integration.

## Verification

- `npx tsc --noEmit --pretty false` — pass.
- Full `npm test` — pass on the final source state.
- `npm run lint` — pass, zero warnings/errors.
- `npm run selftest` — 49 pass, 0 fail, 6 LLM-gated skips.
- `npm run audit:accuracy:strict` — pass, 24/24 coverage.
- `scripts/public-upload-audit.sh` — pass.
- `npm run doctor` — healthy; one Node 22 vs `.nvmrc` Node 20 warning, native SQLite check passes.
- `npm run build` — pass on Next.js 15.5.18 after final browser-found fix.
- `git diff --check` — pass.

## Browser proof

Chrome-controlled desktop 1440x1000 and mobile 390x844 checks covered Dashboard, Live, Collection, Timeline, and New Run in dark/light modes:

- No console warnings/errors on checked surfaces.
- No page-level horizontal overflow.
- Live default: 5,546 baseline DOM nodes to 3,229; 50 session actions rendered.
- Live drawer: 12,759 baseline internal nodes to 1,289; 120 usage rows retained.
- Live expanded 50 to 100 and remained at 100 after a polling interval.
- Drawer and More dialogs restore focus to their triggers.
- Mobile Collection selection scrolls the chosen panel to top, keeps only that panel visible, and writes `?section=sessions#sessions`.
- Browser-found Collection regression corrected from 20,500 DOM nodes / 1,397 rows to 2,751 nodes / 80 rows; Load more advanced to 240 rows.
- Warm APIs: Live 21.7-22.4ms, Collection 4.3-5.3ms, Timeline 5.8-7.9ms.
- Live unchanged-signature poll: 14ms and 71 bytes.

## Boundaries

- No commit, push, tag, deployment, external write, or user-media mutation.
- Pre-existing `PLAN-UX-STABILITY.md`, `media/`, `videos/`, and `open-eval-under-1mb.jpg` remain untracked.
- First-ever Collection load still has no prior last-good snapshot and therefore awaits its first build; subsequent stale reads are background/coalesced.
- Detached Judge execution is not an external worker process; durable state survives restart and interrupted work is rehydrated on the next start.
