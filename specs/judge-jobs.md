# Explicit Judge Jobs and Receipts

## Scope

Manual judge selection applies to both evaluation runs and Timeline sample/all judging. Codex with `gpt-5.6-luna` and Claude are first-class local subscription choices; OpenRouter is optional and appears only when configured. Global Settings remains a default, not a substitute for an explicit job choice.

## Atomic Selection

A judge selection is a source-scoped object containing source, model, optional reasoning effort when supported, resolution provenance, and readiness state. Source and model are validated together so a saved Codex model cannot leak into a Claude or OpenRouter job.

Resolution precedence is:

1. Explicit case grader `judge_harness`/`judge_model` author pin.
2. Explicit evaluation or Timeline job selection.
3. Environment override.
4. Saved Settings default.
5. Codex/`gpt-5.6-luna` fallback.

If an environment policy must forbid a UI choice, reject the job before launch and explain the policy. Never show one backend in the confirmation UI and silently execute another.

## Evaluation Runs

- New Run and CLI accept judge source/model separately from the harness/model under evaluation.
- The run request validates readiness before creation without spending provider tokens.
- The immutable selection is persisted in run params/manifest and emitted in run events/receipts.
- Each rubric result identifies the effective backend after case-level precedence, including infrastructure failures.
- Run detail and reports distinguish agent failure from unavailable/timed-out/malformed judge infrastructure.

## Timeline Jobs

- Sample and all-session POST requests carry an explicit selection.
- Durable SQLite job state stores structured source/model/effort, not only a display string.
- Lease/restart recovery resumes the immutable selection; a Settings change during the job cannot switch backend.
- Status and resulting judgments expose exact backend provenance and bounded failure/recovery detail.
- Timeline populations expose judge source/model and prompt-version distributions. Mixed populations carry a comparability warning rather than collapsing every backend into one generic “judged” denominator.

## Safety and Evidence

- CLI judges keep the existing restricted scratch-workdir execution and exact first-text `JUDGE_PROMPT_MARKER` contamination guard.
- OpenRouter remains explicit; merely having a key never displaces the local subscription default.
- Judge timeout, nonzero exit, unavailable backend, malformed JSON, or out-of-range score is infrastructure error/blocked evidence, never an agent fail and never a fabricated verdict.
- Deterministic stub transport is the default test path; provider-backed success is a separate optional receipt.

## Tests

- Resolution matrix covers case/job/environment/settings/fallback precedence and source-scoped model defaults.
- API/CLI tests cover invalid/unavailable choices, OpenRouter-without-key, immutable persistence, report/event provenance, and no run row on rejected preflight.
- Timeline durability tests cover lease, restart/resume, concurrent Settings changes, structured status, and failure recovery.
- Population tests cover homogeneous and mixed judge/model/prompt-version windows and preserve exact applicable denominators.
- Browser proof selects Codex and Claude in separate jobs and verifies the exact persisted receipt without requiring a paid verdict.
