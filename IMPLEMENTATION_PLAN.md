# Implementation Plan

<!-- Release: First Evidence Loop -->
<!-- Audience: local agent operators, from first-time users to evaluation experts -->

## END_RESULT

OpenEval provides one complete local-first evidence loop: an operator can connect or verify any descriptor-compatible CLI, collect trustworthy source-aware observations, understand a session through a summary-first brief and bounded expert transcript, select Codex/Claude (or configured OpenRouter) explicitly for each judge job, hand the evidence into one linked evaluation, and return to the original and re-check results with raw/derived provenance intact. The product remains free, responsive, and usable without an account or hosted service.

### Acceptance Criteria

- [ ] AC1: From `/harnesses`, a user can validate and persist a custom descriptor, see separate registration/binary/execution/observation/judge readiness, reconnect it after a recoverable failure, and disconnect it without deleting any transcript or evaluation evidence; bundled adapters remain available as immutable references.
- [ ] AC2: A fresh, detect-only, existing-history, API-unavailable, or returning installation follows one resumable connect-or-verify → discover-or-run-once → first-evidence state machine, while expert skip, dismiss, and replay paths remain keyboard accessible.
- [ ] AC3: OpenEval-launched runs retain an authoritative bounded raw stdout/stderr record plus a clearly derived normalized transcript; external pruned sessions explicitly report raw evidence unavailable instead of implying an archive copy exists.
- [ ] AC4: Every configured descriptor can project its declared conversation, reasoning, tool, usage, error, and lineage fields consistently into runner, Live/Collection summary, transcript, and bounded search views; unsupported evidence stays unknown and parser/cache caps stay explicit.
- [ ] AC5: Source-qualified session links resolve only through a server-owned parseable inventory, show a plain-language evidence brief before expert detail, and load each revision-bound 240-turn continuation without rescanning the complete source from byte zero.
- [ ] AC6: New Run and Timeline sample/all jobs require or confirm an explicit source-scoped judge choice; the immutable run/job receipt shows the effective source/model, case-level pins retain precedence, and judge infrastructure failure never becomes an agent failure.
- [ ] AC7: From a session brief, a user can prefill one evidence-linked evaluation/re-check, run it deliberately, and navigate between the immutable original observation and settled run/case result without identity collisions or overwritten history.
- [ ] AC8: Ko-fi, X/contact, other-projects, and Learning AI links are reachable in the desktop and mobile app with optional-support/free-local copy and no account, entitlement, payment, analytics, or credential-storage integration.
- [ ] AC9: A run older than the first 50 records remains searchable, openable, and selectable in Compare, while list/overview/Compare payloads omit transcript bodies and artifact access never requires an unbounded synchronous read.
- [ ] AC10: The isolated automated gate and desktop/390px dark/light browser proof in `specs/product-shell-and-validation.md` pass, with measured payload/DOM/transcript-continuation/storage receipts and no page overflow, uncaught console errors, inaccessible dialogs, or fixtures that write into real harness-session roots.

## Phase 1 — MVP

- [ ] Build the managed harness connection center and layered readiness model per `specs/harness-connection-and-onboarding.md#connection-center` [id:harness-connection-center] [wave:1] (UI: `frontend-design:frontend-design`; use `frontend-app-builder` and Playwright MCP/Chrome when available)
- [ ] Preserve authoritative raw CLI output while bounding SQLite and run/list/Compare API projections per `specs/observation-ingestion.md#raw-authority-for-openeval-launched-runs` [id:raw-run-authority] [wave:1]
- [ ] Replace path-authoritative Collection hydration with the shared source-qualified resolver, revision-bound transcript cursor, and hermetic route fixtures per `specs/transcript-evidence.md` [id:trusted-transcript-windowing] [wave:1]
- [ ] Add canonical in-app support/contact touchpoints per `specs/product-shell-and-validation.md#support-and-contact` [id:product-links] [wave:1] (UI: `frontend-design:frontend-design`; verify external-link and mobile keyboard contracts)
- [ ] Add immutable per-job judge selection and mixed-population receipts for New Run, CLI, and Timeline jobs per `specs/judge-jobs.md` [id:explicit-judge-jobs] [needs:raw-run-authority] (UI: `frontend-design:frontend-design`; use deterministic judge stubs)
- [ ] Complete descriptor-driven semantic normalization parity across runner, summary, transcript, and FTS paths per `specs/observation-ingestion.md#universal-semantic-mapping` [id:universal-observation-normalization] [needs:trusted-transcript-windowing]
- [ ] Unify the overlay and Dashboard guide into the resumable first-evidence state machine per `specs/harness-connection-and-onboarding.md#onboarding-state-machine` [id:first-evidence-onboarding] [needs:harness-connection-center] [needs:trusted-transcript-windowing] (UI: `frontend-design:frontend-design`; verify with Playwright MCP/Chrome)
- [ ] Build the summary-first source-qualified session brief per `specs/transcript-evidence.md#session-brief` [id:session-evidence-brief] [needs:universal-observation-normalization] (UI: `frontend-design:frontend-design`; reuse existing Live/Collection provenance components)

## Phase 2 — Features

- [ ] Persist source-qualified run/observation references and related-attempt lookups per `specs/evidence-handoff.md#observation-reference` [id:observation-attempt-linkage] [needs:explicit-judge-jobs] [needs:session-evidence-brief]
- [ ] Implement the single observation → prefilled evaluation → linked re-check handoff per `specs/evidence-handoff.md#handoff` [id:evidence-recheck-loop] [needs:observation-attempt-linkage] (UI: `frontend-design:frontend-design`; verify the complete browser journey)
- [ ] Bound giant records/parser cardinalities and persist restart-aware parsed-session content identity per `specs/observation-ingestion.md#parser-and-cache-bounds` [id:durable-observation-freshness] [wave:2] [needs:universal-observation-normalization]
- [ ] Add server-side evaluation-history paging and old-run comparison selection per `specs/evaluation-history-and-artifacts.md#evaluation-history` [id:bounded-evaluation-history] [wave:2] [needs:evidence-recheck-loop]
- [ ] Bound and type artifact metadata, preview, streaming, and range delivery per `specs/evaluation-history-and-artifacts.md#artifact-delivery` [id:bounded-artifact-evidence] [wave:2] [needs:raw-run-authority]

## Phase 3 — Polish

- [ ] Integrate loading/empty/error/partial/stale recovery and responsive accessibility across the new flow per `specs/product-shell-and-validation.md#runtime-and-browser-proof` [id:flow-polish-proof] [needs:first-evidence-onboarding] [needs:evidence-recheck-loop] [needs:durable-observation-freshness] [needs:bounded-evaluation-history] [needs:bounded-artifact-evidence] (UI: `frontend-design:frontend-design`; use `frontend-testing-debugging` plus Playwright MCP/Chrome)
- [ ] Run the isolated release gate, record payload/DOM/I/O/storage receipts, and update README/architecture/harness/grader/release docs per `specs/product-shell-and-validation.md` [id:first-evidence-release-proof] [needs:flow-polish-proof]

## Low Priority — Future Release

- Full visual descriptor wizard, template marketplace, provider OAuth/login management, paid-provider smoke tests, credential storage, and remote harness control.
- Automatic immutable archival of every external transcript, pending explicit quotas, retention, deduplication, and deletion receipts.
- Bookmarks, saved views, shared collections, cloud sync, multi-user collaboration, and generalized workflow automation.
- Advanced experiment organization and customizable cross-session analytics beyond the one complete evidence-to-re-check path.
- Run rename/tags, saved suites/comparisons, and archive taxonomy beyond scale-safe access to existing history.
