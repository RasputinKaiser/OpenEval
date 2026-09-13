# OpenEval: animate, harden and delight

Local refinement, September 12, 2026. Preserve the existing visual identity, widened analytical layouts and evidence contracts.

## Delivered behavior

- A chart selection settles into a bordered inspection panel in 180 ms. Selection changes acknowledge the selected evidence without animating axis values or rearranging marks. Both shared time-series and ranked-bar charts use the treatment.
- Copy success has a short check transition and a screen-reader status. Phone copy targets are 44 px. Concurrent writes are guarded; late writes cannot update an unmounted control. Clipboard failure shows a persistent notification with a manual-copy recovery path.
- Notifications fit narrow viewports above the mobile navigation. Their remaining lifetime pauses on hover, keyboard focus and hidden tabs. Timers/listeners clean up on dismissal and unmount; zero-duration notices persist until dismissed.
- Saved views accept Enter submission, retain the typed name when storage fails, show specific save/apply/delete results and offer Undo delete. Delete moves focus to Undo; restoration returns focus to the name field. Names wrap/truncate safely with direction-aware multilingual text. Restoring a view uses the shared selection controller and preserves unrelated URL state.
- Saved-view storage is size bounded, shape checked, canonicalized to permitted chart filters, deduplicated and capped at ten entries. Cross-tab storage changes refresh the list and invalidate obsolete Undo snapshots.
- Dashboard usage and whole-session search requests have 30-second per-request deadlines. Cancellation remains distinct from timeout, network failure, unreadable JSON, changed revisions and rate limits. The search cancels immediately when its input changes and describes paused continuation accurately.
- Route-error retry survives unavailable sessionStorage; it does not depend on storage access to offer in-place recovery.
- Shared headers wrap unbroken text, pressed controls have explicit forced-color outlines, and reduced motion removes the new spatial animations while retaining semantic color and selected state.

## Verification

Three new behavior tests cover request timeouts/cancellation/network errors/unreadable JSON/revision conflicts/rate limits, plus malformed, oversized and multilingual saved-view storage. The combined accessibility and resilience regression passed 15 tests. An existing test initially failed because it required the old notification animation class; it now checks the new class and also requires reduced-motion coverage for notification, inspection and copy feedback. No assertion was removed to bypass a failure.

The final production build, full test suite, typecheck, lint, public-upload audit and git diff check passed after the keyboard-focus and clipboard-unmount adjustments. The confirmation browser pass verified Delete focuses Undo, Undo restores the view and focuses the name input, and test views were removed afterward.

The Impeccable detector found one existing three-pixel line used as a series legend swatch in TimeSeriesChart. This is a labeled data-series encoding rather than an accent border on a card, so it was retained. No new decorative side borders were added.

## Browser proof

Production in-app browser:

- Created a saved view named `QA 日本語 تجربة 🔎`, deleted it, restored it with Undo and removed the test view.
- Forced Dashboard requests offline. The 30-day selection remained in the URL and controls, and an actionable connection message appeared. Restoring connectivity and clicking Retry loaded 470 matching sessions for that range.
- Enter selected September 8. The mounted inspection panel computed to `inspection-settle` / `0.18s`; reduced-motion emulation changed its animation to `none`. The selected evidence and Explore action remained available.
- Reviewed desktop inspection layout and phone reflow. No positive document overflow in the inspected Dashboard and run-detail surfaces. Explicit page-scale reset was necessary after the in-app compositor resized; DOM geometry distinguished that tooling scale from application overflow.
- Copied an actual run ID and observed the Copied state. The previous clipboard was empty and was restored to empty after verification. Phone copy target bounds were approximately 44 × 44 px.

Notification timeout pausing, denied-storage behavior and clipboard-denial presentation were inspected in source; those browser failure modes were not separately induced. Physical touch and assistive-technology certification are outside this bounded QA pass. No before/after performance improvement is claimed. No dependency, paid inference, publication, commit or push was added.
