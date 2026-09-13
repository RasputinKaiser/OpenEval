# Data and transcript hardening

Implemented locally on the existing dirty `codex/app-refinement-evidence` checkout, starting at `fae90707e643d04ee685f1c0378e149208ce8e48`. Existing evidence-navigation and typography work is retained.

## Behavior

- Message/window cursors use versioned AES-256-GCM authenticated encryption. Local file paths and project metadata are no longer readable by decoding the URL. Inventory, source revision and parser checks remain mandatory.
- Default encryption keys persist at `data/.transcript-cursor-key` under the configured data root, with atomic creation and restrictive file permissions. An explicit `OPENEVAL_TRANSCRIPT_CURSOR_SECRET` must contain at least 32 bytes. Preserve the key with private data backups to preserve links; never publish it. Rotation invalidates existing links. Legacy signed-only links require refreshing the session to obtain a new link.
- Whole-session search matches the redacted text surface. Hidden secret and local-username substrings produce no match, while safe surrounding text remains searchable. Scanning, continuation and rendering remain bounded.
- Model filter counts include distinct attributed secondary models once per session. Primary-model charts remain whole-session groupings to avoid multiplying usage; their labels explain that Explore includes secondary appearances.
- Shared cost eligibility distinguishes provider-reported zero, a verified listed-free estimate, unpriced zero placeholders and malformed values. Missing cost remains unavailable. Subscription usage is not inferred from tokens.
- Source and session disclosures distinguish transcript reading, redacted search, normalized conversation and evidence-judge extraction. Format support does not promise every file is readable. New native formats remain unsupported by the judge extractor unless that extractor actually supports them.

No normalized transcript record format changed, so parser version remains 25. Original source evidence is retained.

## Verification

Focused privacy, transcript, analysis, capability and aggregation tests: 72/72 passed. The first full run caught an outdated assertion excluding measured zero from priced coverage; the assertion now requires measured zero to count. The corrected full suite passed. Strict accuracy and the public-upload audit passed. Deterministic self-test: 71 pass, 0 fail; 14 LLM-judge checks were explicitly skipped (no paid judge run). Production build and browser validation are recorded below after completion.

Fixtures cover ciphertext tampering, persistent keys across processes, legacy/stale references, source revision changes, beyond-first-page search, redacted substrings, model population conservation, free/missing/malformed cost and actual unsupported extractor behavior.

Production browser checks before the final compact-table correction: the Models table, model filter option and matching population agree at 446 gpt-5.5 sessions. Whole-session search completed with seven matches across 16 normalized turns; opening a result and reloading retained exact-message focus (`turn-2`) through the encrypted cursor. The session disclosure opened using Enter and remained readable at a requested 390px viewport (433 CSS pixels at the browser's existing zoom), without page overflow. Dark session and light source-table views were inspected. The light source-table screenshot exposed a cramped Format-cell disclosure; it was moved beneath the source name with stacked definition/value pairs for revalidation. These are desktop browser/emulation checks, not physical-device testing.

Final validation: production build and post-build typecheck passed after the compact-table correction; build-integrated lint passed, as did standalone lint before that presentation-only change. Source capability/accessibility checks and diff check passed again. Computer Use confirmed the corrected disclosure is readable beneath the source name in the light desktop table, with no overlapping definition/value text. Dark theme and normal viewport were restored; the production preview is running at http://127.0.0.1:3177/collection#models. No publication or paid inference occurred.
