# Saved experiment contract chosen by PM

Create from the existing Compare context: operator writes hypothesis and chooses a nonempty subset of exact caseId/sample pairs (default all visible shared pairs, with count explicit). Server resolves both completed runs and snapshots their configuration, grader/judge method, case/sample results and selected cohort digest. Preserve origin sourceId/sessionId when supplied. Server validation rejects ambiguous, unknown, same-run, unfinished, invalid or duplicate cohorts rather than silently broadening.

The saved experiment is a historical record with linked original run IDs, not a new scheduler. Load can reopen saved IDs even if they are outside the latest50 list. UI lists saved records, opens hypothesis and cohort/configuration evidence, and links comparison. Snapshot must remain intelligible if a source run is later unavailable or altered. Do not mutate run evidence, launch runs, or claim a change caused a measured delta. Deltas preserve missing values and show paired cohort counts.

For simple additive persistence, separate experiments module may create its table via injected/getDb connection; no unrelated DB refactor. Bounded list, strict JSON body, transactional record creation. Tests use isolated DB and existing run fixtures. No writes to real run records for validation.
