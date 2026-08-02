# Evidence-to-Evaluation Handoff

## Goal

Complete one narrow act-and-re-check loop without building a general bookmark, collaboration, or workflow system.

## Observation Reference

Run cases may persist a source-qualified observation reference containing harness/source, session ID, source revision when known, OpenEval raw-output reference for launched runs, and the originating session brief URL. The reference is additive and migration-safe; old runs remain valid with “link unavailable.”

Collection/Live evidence can locate related run attempts through session ID plus harness/source and bounded time/revision checks. Never join on a bare file path or non-source-qualified session ID.

## Handoff

From a session brief, the operator can choose **Evaluate or re-check this work**. The handoff:

- preserves the original observation reference;
- pre-fills a bounded New Run investigation context (harness/model when valid, task/evidence excerpt, and selected existing case when a relationship exists);
- otherwise offers a draft case/improvement prompt as a local, editable handoff rather than claiming an executable case already exists;
- lets the operator change evaluated harness/model and explicitly choose the judge;
- records the origin when the evaluation starts.

After the run settles, the source session brief and run/case detail link to each other. The comparison shows the original and re-check status, exact evidence availability, and judge provenance without overwriting history or claiming causality.

## Boundaries

- No automatic run launch, model spending, case publication, or external message.
- No generated diagnosis is treated as fact without source evidence.
- No broad saved-view/bookmark/collection system in this release.

## Tests

- Identity/link tests prevent collisions across sources and duplicate session IDs.
- Prefill tests preserve origin, validate untrusted URL/localStorage values, and degrade safely when the harness/case/session is unavailable.
- Lifecycle tests prove the original remains immutable and related attempts survive reload/restart.
- Browser proof covers session → prefilled New Run → linked result → original evidence at desktop and 390px.

