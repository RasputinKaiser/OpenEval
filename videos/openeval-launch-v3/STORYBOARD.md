---
format: 1920x1080
message: "OpenEval turns agent activity into evidence you can watch, compare, and trust."
release: "v0.1.4 product-suite refresh"
arc: "Proof chain: question → build → observe → signal → compare → coverage → decision"
audience: "agent builders and evaluation operators"
mode: autonomous
language: English
duration: 29.5s
audio: "Music-led; structured UI transition-hit mix; no narration"
---

## Video direction

This is the v0.1.4 cut, recorded from the current local suite after the Evaluate/Observe refresh. It deliberately keeps the original proof-first arc while replacing the product footage with a new route set: Dashboard, Live, Collection, Timeline, New Run, Runs, Compare, Cases, Bench, Accuracy, and visual artifact cases. Evaluation-detail footage is captured with the app-wide default-on privacy redaction; raw run data and artifacts are not modified.

- Palette: dark `ink-black` grounds; `cream` for primary type; OpenEval violet as the single signal color; hairline `border-dark` structure. Use the violet as either one accent on dark or one full declarative field, never as a second decorative palette.
- Type: massive lowercase display for one decisive statement; restrained body copy; tracked mono labels for evidence chrome. One display moment dominates each frame.
- Motion grammar: nine scenes across 29.5 seconds, varying between 2 and 3.5 seconds. Each scene reveals quickly, develops through micro-staggers, and preserves a clean reading hold. Every chapter cut uses the same violet editorial aperture wipe; variation comes from the footage layout, not from unrelated transition effects.
- Reveal model: the provocative opening question is fully readable before 0.9 seconds. Thereafter, paired authentic footage lets each scene make one complete claim without an extra midpoint page swap.
- Rhythm: global scene resets land at 0, 2, 5, 8.5, 12, 15.5, 19, 22.5, and 26 seconds. Frame 4 is the one full-violet pattern interrupt; the final brand lockup resolves by roughly 27 seconds and holds for the last 2.5 seconds.
- Product identity: a feed-readable `OpenEval / Agent Evaluation Platform` strap remains visible from the opening frame through 26 seconds, then clears before the hero wordmark. Its violet marker pulses only at scene resets.
- Product focus: authentic dashboard clips receive a modest brightness/contrast lift, while one focal proof surface per feature scene carries the strongest violet edge.
- Utility labels: communicative evidence and process labels use a 24–29px feed-readable target, strong weight, and an explicit backing or high-contrast rule; 15–17px type is reserved for nonessential catalogue chrome. Labels must remain readable around a 960×540 embed and never rely on low-opacity black or gray type alone.
- TouchDesigner: use the noise-displaced violet scan as a short attention cue at 0.0–1.2, 2.12–3.32, and 22.70–23.90 seconds. Each pass is deliberately faint and clears before it can compete with the claim or dashboard evidence.
- Sound structure: the 161 BPM Pulse bed follows five native four-bar phrases. The existing transition-hit stem is mixed underneath it with gentle sidechain ducking, placing restrained arrivals around the dashboard reveal, repeatable-run beat, signal turn, comparison, and the final cost/performance/accuracy cadence. The music fades in over the opening silence and releases into a short clean tail; there is no narration or voice layer.
- Composition: interface footage remains legible and undistorted inside sharp, flat proof-windows with one shared hairline/shadow treatment. The chapter rail makes the progression legible without adding narration. Important content stays in the top ~83%; the bottom caption band remains clear even though captions are disabled.
- Never: gradients, glassmorphism, rounded-card clutter, browser chrome, fake UI details, floating particles, generic AI imagery, bounce, lazy breathing, uncontrolled camera drift, slideshow front-load-then-freeze, or screensaver-style independent motion.

## Narrative order

The source compositions retain their feature-oriented filenames, but the screen order is deliberately causal:

| Time | Screen beat | Viewer takeaway |
| --- | --- | --- |
| 0.0–5.0s | Question → evidence | Your shipped agent work needs inspectable proof. |
| 5.0–8.5s | Make it repeatable | Start a run, keep the history, and make the proof reproducible. |
| 8.5–12.0s | See the system | Watch tokens, tools, quality, and session intelligence while it runs. |
| 12.0–15.5s | Turn history into signal | The collected trace becomes trends, regressions, and change. |
| 15.5–19.0s | Compare the artifacts | Inspect textual and visual output side by side. |
| 19.0–22.5s | Trust needs coverage | Scores become meaningful when coverage and known-bad evidence are visible. |
| 22.5–26.0s | Know what to ship | Cost, performance, and accuracy converge into a decision. |
| 26.0–29.5s | OpenEval lockup | The proof loop resolves into the brand and acknowledgment. |

This order is intentionally different from the composition filenames: it follows the user's mental model from initiating an evaluation to deciding whether its output is ready to ship.

## Frame 1 — Make it evidence

- scene: Fresh OpenEval dashboard footage appears inside a stark proof-window, then yields to a two-part launch statement.
- voiceover:
- duration: 5s
- transition_in: cut
- poster: 3s
- status: animated
- src: compositions/frames/01-make-it-evidence.html
- type: hook
- persuasion: Outcome framing
- beat: tension → clarity
- blueprint: video-text-pivot (Adapt)
- asset_candidates: assets/footage-v0.1.4/01-dashboard-overview.mp4 — refreshed dashboard overview; assets/footage-v0.1.4/07-leaderboard.mp4 — refreshed harness leaderboard evidence; assets/td-evidence-pulse.mp4 — TouchDesigner-authored violet evidence scan overlay
- focal: assets/footage-v0.1.4/01-dashboard-overview.mp4
- roles: 01-dashboard-overview.mp4 = background · 07-leaderboard.mp4 = supporting proof · td-evidence-pulse.mp4 = overlay

narrativeRole: Open on the viewer's existing agent work, then name the missing outcome: inspectable evidence.
keyMessage: Your agents already did the work. OpenEval makes it evidence.

Adapt: keep the product-video-to-impact-text weight transfer; replace the invented hero stat with a second real dashboard clip and preserve the same-anchor handoff.
Scene 1 (0.0–2.0s): dashboard overview and a compact harness-leaderboard proof surface settle immediately into an asymmetric evidence spread. `Your agents shipped. Can you prove it?` is fully readable before 0.9 seconds while the TouchDesigner scan crosses once.
Scene 2 (2.0–5.0s): both proof-windows clear completely on the reset; `now make it evidence.` takes the field in massive lowercase display over a restrained ImageGen evidence field. A short TouchDesigner scan redirects attention into the statement, then `OpenEval turns live traces into ship decisions.` appears for the reading hold.

## Frame 2 — See the system

- scene: Two live-observation views advance inside a precise interface viewport while short labels call out usage, quality, and session intelligence.
- voiceover:
- duration: 3.5s
- transition_in: zoom-through
- poster: 3s
- status: animated
- src: compositions/frames/02-see-the-system.html
- type: product_intro
- persuasion: Show-don't-tell proof
- beat: curiosity → control
- blueprint: device-surface-showcase (Adapt)
- asset_candidates: assets/footage-v0.1.4/02-live-observation.mp4 — refreshed live usage and quality observability; assets/footage-v0.1.4/03-collection-signal.mp4 — refreshed session/collection intelligence
- focal: assets/footage-v0.1.4/03-collection-signal.mp4
- roles: 02-live-observation.mp4 = supporting · 03-collection-signal.mp4 = cutout

narrativeRole: Establish OpenEval as a live operating surface, not a static report.
keyMessage: See tokens, tools, quality, and trace intelligence while agents work.

Adapt: keep the persistent floating-window tour and discrete screen advances; use two authentic recordings instead of reconstructed UI states, with no fake cursor.
Scene 1 (0.0–3.5s): usage and quality establish beside `see the system`; the session-intelligence surface overlaps as a focused foreground proof window. `TOKENS`, `TOOLS`, `QUALITY`, and `TRACE INTELLIGENCE` assemble as one operating surface.

## Frame 3 — Turn history into signal

- scene: Collection context and a trend timeline share the frame, resolving into a bold signal statement.
- voiceover:
- duration: 3.5s
- transition_in: push-slide LEFT
- poster: 3s
- status: animated
- src: compositions/frames/03-history-into-signal.html
- type: feature_showcase
- persuasion: Feature-to-benefit translation
- beat: clarity + momentum
- blueprint: comparison-split (Reproduce)
- asset_candidates: assets/footage-v0.1.4/03-collection-signal.mp4 — refreshed collection-level overview; assets/footage-v0.1.4/04-timeline-trends.mp4 — refreshed timeline and trend analysis
- focal: assets/footage-v0.1.4/04-timeline-trends.mp4
- roles: 03-collection-signal.mp4 = supporting · 04-timeline-trends.mp4 = cutout

narrativeRole: Move from momentary observation to longitudinal understanding.
keyMessage: Turn run history into trends, regressions, and adoption signals.

Scene 1 (0.0–3.5s): `history becomes signal` seats above paired collection-context and timeline-trend proof windows; `CONTEXT`, `TREND`, and `REGRESSION / ADOPTION / CHANGE` resolve in one comparison.

## Frame 4 — Make it repeatable

- scene: A new-run builder hands off to run history as a four-step evidence loop assembles around the footage.
- voiceover:
- duration: 3.5s
- transition_in: push-slide LEFT
- poster: 3s
- status: animated
- src: compositions/frames/04-make-it-repeatable.html
- type: feature_showcase
- persuasion: Friction reduction
- beat: relief + control
- blueprint: cursor-ui-demo (Adapt)
- asset_candidates: assets/footage-v0.1.4/05-new-run-builder.mp4 — refreshed new evaluation run builder; assets/footage-v0.1.4/06-runs-history.mp4 — refreshed evaluation runs history
- focal: assets/footage-v0.1.4/05-new-run-builder.mp4
- roles: 05-new-run-builder.mp4 = cutout · 06-runs-history.mp4 = supporting

narrativeRole: Convert observed agent behavior into a repeatable evaluation workflow.
keyMessage: Build the run, keep the history, repeat the proof.

Adapt: keep the stepwise workflow chase and locked payoff; let the recorded app interactions drive the story instead of adding a synthetic cursor.
Scene 1 (0.0–3.5s): a full-violet pattern interrupt lands `repeat the proof.` above paired builder and run-history windows; `BUILD / RUN / KEEP / REPEAT` advance across one horizontal evidence loop.

## Frame 5 — Compare the artifacts

- scene: A Markdown runbook and a voxel world artifact lock into a hard split, turning visual quality into something you can actually compare.
- voiceover:
- duration: 3.5s
- transition_in: violet aperture wipe LEFT
- poster: 3s
- status: animated
- src: compositions/frames/05-compare-what-matters.html
- type: benefit_highlight
- persuasion: Comparative proof
- beat: confidence + power
- blueprint: comparison-split (Reproduce)
- asset_candidates: assets/footage-v0.1.4/13-visual-markdown-proof.mp4 — Markdown artifact proof; assets/footage-v0.1.4/15-visual-voxel-artifact-preview.mp4 — derived observed voxel-world artifact preview; assets/footage-v0.1.4/08-compare-runs.mp4 — refreshed run comparison context
- focal: assets/footage-v0.1.4/15-visual-voxel-artifact-preview.mp4
- roles: 13-visual-markdown-proof.mp4 = supporting · 15-visual-voxel-artifact-preview.mp4 = visual-output focal

narrativeRole: Show that OpenEval can place textual and visual output into one inspectable comparison frame, not merely record a run.
keyMessage: Compare runs, inspect evidence, and watch the outputs side by side.

Scene 1 (0.0–3.5s): `compare the artifacts` seats above a hard split of Markdown and an observed voxel-world artifact preview; the violet equality mark resolves between the two outputs, followed by `COMPARE RUNS / INSPECT EVIDENCE / WATCH OUTPUTS`. The preview is a visual sample, not an inferred visual-quality verdict.

## Frame 6 — Trust needs coverage

- scene: Confidence evidence and the case library alternate around a large coverage statement and three restrained proof markers.
- voiceover:
- duration: 3.5s
- transition_in: violet aperture wipe RIGHT
- poster: 3s
- status: animated
- src: compositions/frames/06-trust-needs-coverage.html
- type: social_proof
- persuasion: Risk reversal
- beat: skepticism → trust
- blueprint: grid-card-assemble (Adapt)
- asset_candidates: assets/footage-v0.1.4/09-run-confidence.mp4 — refreshed confidence and proof-coverage view; assets/footage-v0.1.4/10-cases-library.mp4 — refreshed reusable evaluation cases library
- focal: assets/footage-v0.1.4/09-run-confidence.mp4
- roles: 09-run-confidence.mp4 = cutout · 10-cases-library.mp4 = supporting

narrativeRole: Answer the trust objection by showing what supports every score.
keyMessage: Trust comes from coverage, known-bad cases, and reusable evidence.

Adapt: keep the accumulating proof-list signature; use two live product surfaces as anchors and assemble three restrained evidence lines instead of a generic card grid.
Scene 1 (0.0–3.5s): `trust needs coverage.` arrives over simultaneous run-confidence and reusable-case evidence. `COVERAGE`, `KNOWN-BAD CASES`, and `REUSABLE EVIDENCE` assemble before one restrained violet scan crosses the pair.

## Frame 7 — Know what to ship

- scene: Bench telemetry and the accuracy audit culminate in an OpenEval lockup, final launch line, and an integrated acknowledgment to @Bootoshi from righttointelligence.org.
- voiceover:
- duration: 7s
- transition_in: zoom-through
- poster: 4.5s
- status: animated
- src: compositions/frames/07-know-what-to-ship.html
- type: cta
- persuasion: Future pacing
- beat: triumph + inevitability
- blueprint: logo-assemble-lockup (Adapt)
- asset_candidates: assets/footage-v0.1.4/11-bench-telemetry.mp4 — refreshed cost and performance telemetry; assets/footage-v0.1.4/12-accuracy-audit.mp4 — refreshed accuracy audit and evidence review
- focal: assets/footage-v0.1.4/12-accuracy-audit.mp4
- roles: 11-bench-telemetry.mp4 = supporting · 12-accuracy-audit.mp4 = cutout

narrativeRole: Resolve the proof arc into the decision OpenEval enables.
keyMessage: Prove cost, performance, and accuracy—then know what to ship.

Adapt: keep the CTA push-through and terminal lockup signature; replace an invented logo mark with the OpenEval wordmark and a precise violet evidence aperture.
Scene 1 (0.0–3.5s): `cost. performance. accuracy.` establishes the decision criteria above a layered-depth pair of bench telemetry and the brighter, violet-edged accuracy audit. The three compact evidence labels then reveal across the proof surfaces.
Scene 2 (3.5–7.0s): the evidence pair clears in one reset. The enlarged `know what to ship. / OpenEval / EVIDENCE FOR AGENT SYSTEMS.` lockup resolves quickly, then adds the prominent integrated line `THANK YOU, @Bootoshi — FROM RIGHTTOINTELLIGENCE.ORG` before the final hold.
