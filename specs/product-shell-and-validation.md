# Product Shell, Support, and Release Validation

## Support and Contact

Add a compact, accessible in-app support surface reachable on desktop and mobile:

- Support OpenEval: `https://ko-fi.com/rasputinkaiser`
- Contact on X: `https://x.com/RasputinKaiser`
- Other projects: `https://ras.artificiallexicon.com/`
- Learning AI: `https://www.artificiallexicon.com/`

Links open as normal external navigation with safe `rel` behavior, clear accessible names, and visible keyboard focus. Copy states that OpenEval is free/local-first and support is optional. Do not add an account, entitlement, payment API, billing SDK, analytics beacon, or payment-data storage. Align README’s Ko-fi target with the canonical URL.

## Existing UI to Preserve

The current Dashboard, Evaluate/Observe/System IA, mobile safe-area nav, progressive sections, responsive charts, Live lazy detail, Collection cursor list, Timeline denominator disclosure, and evaluation evidence surfaces are mature. This release performs integration polish and proof, not a broad visual redesign.

## Automated Gate

Run in an isolated data root where applicable:

1. `npm run typecheck`
2. `npm test`
3. `npm run lint`
4. `npm run build` with the dev server stopped
5. `npm run selftest`
6. `npm run audit:accuracy:strict`
7. `scripts/public-upload-audit.sh`
8. `git diff --check`

Focused tests introduced by this release must cover harness lifecycle/readiness, raw run capture, universal semantic mapping, trusted transcript resolver/windowing, explicit judge jobs, onboarding, evidence handoff, support-link contracts, evaluation-history paging, bounded overview/Compare payloads, and artifact delivery. Existing parser/cache/Collection/Timeline/evaluation/a11y suites remain green.

## Runtime and Browser Proof

- Restart the server after a production build before browser proof.
- Use the configured OpenEval preview and confirm title/branding before capture.
- Verify APIs directly before UI claims: harness readiness, Collection identity/window continuation, run judge receipt, Timeline job receipt, and linked attempt identity.
- Browser routes: `/`, `/harnesses`, `/live`, `/collection`, one source-qualified session, `/collection/timeline`, `/runs/new`, one linked run/case, `/settings`.
- Viewports/themes: desktop and 390px, dark and light.
- Interactions: keyboard focus/trap/restore, connect/disconnect/reconnect, onboarding resume, transcript next window, judge selection, evidence handoff, external support links, loading/empty/error/partial/stale states.
- Assert no horizontal page overflow, Next error overlay, uncaught console error, inaccessible dialog, or hidden focus target.

## Performance and Storage Receipts

Record before/after or enforced ceilings for:

- Harness registry/readiness response size and probe latency.
- Live and Collection initial/list response size and DOM rows.
- Session brief and first transcript window payload/latency.
- Second transcript window bytes read and latency, proving no complete file rescan.
- Raw-output bytes versus normalized projection bytes and capture completeness.
- SQLite/live-cache/raw-run storage totals with partial/lower-bound warnings where traversal is capped.

Do not infer smoothness or completeness from one CPU measurement. Report rejected, stale, partial, and raw-unavailable receipts explicitly.
