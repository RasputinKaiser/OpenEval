# App refinement and evidence depth

This local tranche retains OpenEval's navigation, visual identity, and main workflows while making analytical controls easier to inspect and restoring state across navigation. It does not execute provider-backed judging or publish a release.

## Interface changes

- The desktop sidebar is viewport-height and sticky. Its navigation list can scroll independently, while support links and theme/collapse controls stay accessible. Compact links retain full accessible names. Collapsed controls stack inside the narrow sidebar. Hidden tabs no longer poll the sidebar run counter on every interval.
- Evaluate navigation is compact. Runs puts filtering before optional analysis and moves the secondary overview below the run list. Two selected runs form an explicit A/B comparison, with URL-backed selection.
- Distribution panels distinguish missing measurements from zero and report the median and 90th percentile over available observations. Runs uses recorded elapsed time, run detail uses case/sample results, and Live respects filtered sessions and measurement provenance.
- Compare plots actual A/B values on one shared scale. A missing side has no mark. The existing transition matrix and delta evidence table remain available.
- Dashboard adds recent calendar-bucket volume and cost panels; bucket scope, incomplete costs, and outcome provenance remain separate.
- Collection can store up to ten named filter views in the browser. Existing full-population analysis and bounded session paging remain authoritative.
- Cases and New Run expose category, difficulty, and declared evidence composition, reference-answer coverage, cost-ceiling declarations, and planned execution counts. These describe case definitions, not measured pass rates.
- Leaderboard filters category/model and can restrict aggregation to graded case/sample pairs shared across harnesses. Repeated runs remain explicit; shared pairs do not imply equal model mixes or independent trials. The evidence table includes descriptive Wilson intervals, and partial cost totals retain coverage labels.
- Accuracy adds a clickable cross-surface coverage matrix. Harnesses adds declared capability comparison. Settings provides section links and retains its existing save/health controls.
- Timeline adds a source-qualified evidence lab, receipt sequence lanes, episode/channel filtering, bounded excerpts, and separate deterministic dimensions.

## Evidence boundaries

Evidence packets normalize source records with stable source/session identity, evidence IDs, content digests, bounded excerpts, and explicit read/retention limits. Opening asks, constraints, important events, and recent records are preserved under a bounded streaming read. Unsupported stores and unread tails remain unknown.

Assistant prose is available as task context and, for text tasks, the deliverable. An assertion that a command succeeded is not an observed command receipt. A harness turn-completion event proves transport completion, not goal achievement. Recovery requires the same normalized command/check within the same task episode; an unrelated successful shell command does not resolve a failed test. Evidence sufficiency is independent of whether observed evidence is positive or negative.

The new `/api/collection/evidence` endpoint accepts only source and session IDs, resolves the current collection inventory, and checks source revision before and after reading. It is read-only, bounded, non-cacheable, and returns controlled errors without exposing filesystem paths as authority. Archived-only sessions have no reconstructable transcript packet.

## Review contract and history

The v4 review contract separates achieved, partial, not achieved, and insufficient evidence. Insufficient evidence has a null score. Completion, verification, recovery, unresolved issues, and sufficiency remain separate dimensions. Assistant text may be the deliverable in writing or conversational work; claimed command results cannot serve as execution verification. All citations, including dimension citations, must be present in the actual bounded prompt. Packet and prompt omissions are disclosed, and incomplete evidence cannot silently become a midpoint quality score.

The model prompt retains at most 48 causally selected excerpts from a packet of at most 256 records, 4 MiB of source reads, 600 characters per packet excerpt, and 16 task episodes. Long or unsupported sources may therefore remain unscored. The deterministic backend reports receipt dimensions and proves transport behavior; it does not manufacture a model quality score. Synthetic fixtures validate the contract, not live Luna accuracy.

Review previews use date, source, model, reason, and session-budget filters. Invalid filters are rejected instead of broadening the scope. The selected review backend, model, and reasoning effort affect queue eligibility. Preview and execution use the same queue contract, with at most 50 sessions and serial execution. The UI uses a durable background job; API requests containing more than four sessions also move to that job. Previewing never invokes a model.

New reviews bind source/session identity, packet digest, prompt version, review method, and source revision. Current revisions include filesystem change time as well as modification time, size, and observed source cardinality. Rendering uses cheap revision checks; a selected provider pass rereads and compares the bounded digest before persistence. An atomic transaction retains history and updates or clears the numeric projection together. Failed or ignored writes roll back. Superseded v2/legacy scores are retained as legacy JSON, without fabricated v4 fields. New history no longer hides unrelated older receipts from the report.

## Polish and hardening

The final pass enlarged mobile Runs controls, removed search-width movement on focus, validated saved browser views, invalidated queue previews immediately when scope or method changed, corrected case-library execution labels and Dashboard signal denominators, and retained accessible empty/error/loading states. Theme, sidebar, keyboard, and reduced-motion behavior were inspected in the production preview.

## Verification notes

- Full automated suite: **832 tests passed, 0 failed, 0 skipped**, including strict verdict/citation fixtures, source/session identity, review-method changes, invalid request filters, atomic rollback, null-score supersession, real v2 history, and mixed historical receipt counts.
- TypeScript, lint, and the final optimized production build passed.
- Self-test: **71 passed, 0 failed**; **14 model-judge checks skipped**. No provider-backed review was run.
- Strict accuracy audit passed its required structural checks. Trace steps (2 applicable cases), visual contracts (14), and LLM judges (7) still report runtime proof as unknown; those states were not relabeled as passing.
- Doctor passed the native database binding and integrity checks. The active Node 22 runtime differs from the repository's Node 20 preference; the native module loads under the active runtime. The final doctor run reports a complete, current build cache and healthy runtime with that one version warning.
- Browser checks covered Dashboard, Live, Collection, Timeline, Runs/detail/Compare, Leaderboard, Cases/New Run, Accuracy, Harnesses, and Settings across the refinement rounds. Checks included comparison URL restoration through Back/reload, saved-view persistence and cleanup, matched-workload filtering, matrix drilldown, evidence packet inspection, review preview invalidation, and no horizontal overflow in the inspected mobile layouts.
- The sidebar was checked at a 1280 × 720 CSS viewport with the page scrolled. Support and theme controls stayed inside the viewport, and collapsed controls stayed inside the narrow sidebar.
- Hover/pin/Escape behavior and viewport clamping were inspected. Reduced-motion emulation reported no chart animation and a zero-duration chart transition. Both themes were visually inspected and the original dark theme restored.

Earlier failing checks exposed actual persistence, identity, and history-accounting issues as well as old fixtures that hardcoded obsolete prompt versions or blank session IDs. The production rules stayed strict; fixtures were updated to carry valid current identity/version data while preserving the original denominator assertions. Final passing results above follow those corrections.

This is local implementation and production-preview proof. No release was published, and no claim of live Luna calibration or a measured frame-rate improvement is made.
