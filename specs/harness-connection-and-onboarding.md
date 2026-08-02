# Harness Connection and First-Evidence Onboarding

## Existing Contract to Preserve

- `lib/adapters/schema.ts`, `generic.ts`, `builtin.ts`, `loader.ts`, and `registry.ts` already make bundled and custom harnesses share one descriptor contract.
- `lib/adapters/discover.ts` and `app/api/harnesses/route.ts` already provide safe, non-spending version/help probes.
- `components/HarnessesClient.tsx` already exposes descriptor issues, capabilities, command previews, trace declarations, and per-harness probes.
- `components/FirstRunGuide.tsx`, `components/OnboardingOverlay.tsx`, and `components/first-run-steps.ts` already distinguish checking/unavailable/empty/ready states and support dismiss/replay.

## Connection Center

The Harnesses route becomes the managed local connection center.

### Registration lifecycle

- Import or paste one complete `.harness.json` descriptor, validate it with the existing strict schema, preview its normalized execution/observation contract, and atomically persist it beneath `HARNESS_DESC_DIR`.
- Editing a user descriptor uses compare-and-replace semantics so a stale browser cannot overwrite a newer file unnoticed.
- File names derive from the validated descriptor ID. Reject traversal, absolute paths, symlink targets, control characters, and writes outside the descriptor directory.
- A custom connection has explicit provenance: user-managed, user override of bundled, or bundled reference.
- Disconnect is recoverable registration disable/removal only. It never removes raw traces, run transcripts, SQLite rows, or cached archived summaries.
- Bundled descriptors cannot be deleted. If a user override is disconnected, the bundled descriptor with the same ID becomes visible again after cache invalidation.
- Registry/descriptor/discovery caches refresh after mutation, and the saved state survives a process restart.

### Readiness layers

Never collapse these into one green “connected” state:

1. **Registration:** descriptor valid and enabled.
2. **Binary metadata:** descriptor-declared version/help probes succeed without a model call.
3. **Execution readiness:** the CLI can be selected for a run; provider/auth readiness remains unknown until safely observed or a real run supplies evidence.
4. **Observation readiness:** `liveTrace` is declared, roots are present or honestly absent, candidate files are discoverable, and parser coverage is measured separately from detect-only inventory.
5. **Judge readiness:** the source is eligible for judge work and its selected model/source pair is valid; this is still distinct from a provider-backed verdict.

Every unavailable, partial, or unknown layer has a bounded diagnostic and a concrete recovery action. A declaration is not runtime proof. Reconnect means refresh the saved descriptor/binary/root state and re-run safe probes; it does not run a paid model request.

## Onboarding State Machine

Replace the split first-run criteria with one pure, tested state machine shared by the overlay and Dashboard guide.

States cover:

- APIs checking or unavailable;
- no registered/ready harness;
- registered but binary or observation readiness needs attention;
- detect-only history without parseable evidence;
- existing parseable history;
- execution-ready but truly empty installation;
- first evidence opened;
- first evaluation recorded;
- dismissed and replayed guidance.

The resumable path is:

1. Connect or verify a harness on `/harnesses`.
2. If parseable sessions exist, open the newest source-qualified evidence brief.
3. If no parseable session exists but execution is ready, launch one bounded evaluation or instruct the operator to run the harness once, then re-check.
4. Open the resulting evidence view and explain measured versus derived/raw availability.
5. Offer the explicit judge/evaluation path; do not require it before the user can understand existing evidence.

Unavailable API state is never rendered as zero. Detect-only files never complete the evidence step. Guidance remains dismissible, keyboard accessible, focus-safe, responsive, and replayable from Settings. Expert route navigation remains available throughout.

## Tests

- Schema/store/API tests: invalid JSON, invalid descriptor, traversal, symlink, duplicate override, stale update, atomic persistence, restart reload, disconnect/reconnect, bundled fallback, and evidence preservation.
- Readiness tests: each layer can independently be ready, partial, unavailable, or unknown; no provider call is needed to pass metadata checks.
- Onboarding tests: one state machine drives both surfaces; detect-only, existing-history, empty, API-failure, reload/resume, dismiss/replay, and successful evidence handoff states.
- Browser proof: import/connect, safe probe, disconnect/reconnect, and first-evidence handoff at desktop/390px with keyboard focus and no horizontal overflow.

