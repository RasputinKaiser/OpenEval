# OpenEval launch v5 — quarter-second attention audit

## Scope

- Source reviewed: `renders/video-v4-focus-final.mp4`
- Cadence: every 0.25 seconds from 0.00 through 29.25 seconds
- Evidence: 118 extracted source frames and 118 revised HyperFrames snapshots
- Review surfaces: six chronological source sheets, six chronological v5 sheets, and three final-delta sheets
- Objective: improve the first-two-second hook, product recognition, reading holds, scene separation, and visual focus without increasing the 29.5-second runtime

## Quarter-second ledger

| Time | Attention state observed | v5 decision |
| --- | --- | --- |
| 0.00–0.75 | Dashboard proof arrives immediately; question resolves inside the two-second hook. | Preserve the instant product reveal; reduce the violet scan opacity so it directs rather than masks. |
| 1.00–1.75 | Hook remains readable, with enough time to register the dashboard and question. | Keep the clean hold and persistent OpenEval identity strap. |
| 2.00–2.75 | The prior text-only reset felt comparatively empty and static. | Introduce a restrained evidence-field plate and one short TD scan; stage `now`, `make it`, then `evidence.` |
| 3.00–3.75 | The central claim needed a product-specific reason to keep reading. | Add `OpenEval turns live traces into ship decisions.` and a single restrained violet emphasis pulse. |
| 4.00–4.75 | The statement needed to remain stable before the first feature cut. | Hold the full claim; stop new motion before the 5.0-second reset. |
| 5.00–5.25 | The prior transition briefly stacked outgoing and incoming headline ideas. | Shorten the outgoing fade and delay the incoming reveal for clean semantic separation. |
| 5.50–8.25 | Live-system proof is legible and progressively weighted. | Preserve the feature hold; keep the enlarged product strap out of the primary headline lane. |
| 8.50–11.75 | History-to-signal scene has a clear paired-surface hierarchy. | Preserve pacing and focal edge; avoid extra page swaps. |
| 12.00–15.25 | Violet pattern interrupt resets attention without losing the story. | Preserve the full-field reset and its short reading hold. |
| 15.50–18.75 | Repeatability and comparison proof are readable at feed scale. | Preserve the stagger; maintain one dominant proof surface at a time. |
| 19.00–19.25 | The prior compare-to-coverage transition briefly mixed two headline claims. | Separate outgoing and incoming headline timing before the coverage scene builds. |
| 19.50–22.25 | Coverage montage is dense but understandable because the headline stays singular. | Preserve the accumulation and keep the identity strap narrow and stacked. |
| 22.50–23.00 | Incoming decision-evidence videos previously appeared under the outgoing coverage headline. | Delay both incoming product videos until 22.66 seconds; delay the scan until 22.70 seconds. |
| 23.25–25.75 | Cost, performance, and accuracy read as one decision set. | Keep the montage stable; lower the TD scan opacity to protect UI legibility. |
| 26.00–27.00 | Closing decision statement resolves quickly after the montage. | Preserve the hard reset and remove the persistent strap before the hero wordmark. |
| 27.25–29.25 | Final OpenEval lockup has a clean, confident hold. | Preserve the 2.5-second brand hold with no late decorative motion. |

Every quarter-second timestamp in the 29.5-second cut was inspected. The table groups contiguous timestamps only when the visual state and resulting decision were identical.

## Implemented attention changes

1. Added an ImageGen-authored evidence field to the previously static 2.0–5.0-second claim.
2. Added the product promise `OpenEval turns live traces into ship decisions.` during the central reading hold.
3. Reused the TouchDesigner scan as three low-opacity focus cues instead of a dominant effect.
4. Enlarged and clarified the persistent identity strap to `OpenEval / Agent Evaluation Platform`.
5. Removed competing-claim overlap at 5.0 and 19.0 seconds.
6. Delayed the 22.5-second product montage so the outgoing coverage claim clears first.

## Final-delta result

The 22 focused snapshots at the revised hook and the 5.0, 19.0, and 22.5-second seams are clean: no stacked headlines, no premature incoming dashboard, and no scan that blocks the product UI.
