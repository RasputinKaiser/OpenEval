# Interactive analytics design QA

Status: completed for the bounded implementation and Impeccable refinement. Production review used an isolated `.next-interactive` build at http://127.0.0.1:3177. Existing development output was kept separate.

## Visual reference and result

OpenEval's incumbent charcoal/white surfaces, violet interaction color, cards and analytical tables remain the reference. The supplied ChatGPT screenshot informed range/grouping controls only. Collection and the other analytical routes now fill the available canvas; transcript prose retains a reading measure. The Collection desktop heading begins at approximately 264 CSS pixels, immediately after the sidebar and normal page padding, rather than inside the previous large centered gutter.

Impeccable clarify, colorize and typeset refinements passed the bounded visual review: 24px page headings, 16px subtitles and chart titles, readable collection labels, teal inventory headings, amber API-equivalent estimate headings, and violet tool activity headings. Transcript prose computes to 16px/28px with a 72ch maximum. Existing system fonts avoid additional font loading.

## Production browser proof

- Dashboard, Collection, Timeline, Live, Runs, Compare, Leaderboard and Accuracy rendered at desktop and phone widths with no positive document-level horizontal overflow. The final typography build repeated all eight phone-route checks.
- Final Collection screenshots reviewed in dark desktop and light phone layouts. The browser's existing 90% zoom makes the 1440px device viewport approximately 1600 CSS pixels, and 390px approximately 433 CSS pixels. The transcript also passed at a 320px device viewport (approximately 355 CSS pixels).
- Reduced-motion media preference was active during the final narrow checks. Inputs, wrapping controls, labels and selection remained usable. No console errors were captured in the final route sweep.
- Seven-day preset showed September 6–12 inclusive, with UTC bucket starts and an exclusive September 13 URL boundary. The final snapshot had 114 sessions: 25 + 5 + 1 + 5 + 21 + 30 + 27. The accessible table agreed with the chart and reported population.
- Enter pinned September 8 and exposed Explore sessions; Escape cleared inspection. Period selection offers a native select for touch/keyboard use. Earlier in the same production review, Explore navigated to the one matching Hermes session, then into its transcript. Browser Back restored Collection and Dashboard filters.
- Custom date submission to January 1–2, 2100 updated the URL to the correct inclusive/exclusive boundaries and rendered zero matching sessions with explicit empty chart states. It did not fabricate token or cost observations.
- Whole-session search scanned 1,788 semantic turns: no matches for one query, six matches for `benchmark`. Next match selected message 1,119 beyond the first page. Open context loaded messages 961–1,200 and placed turn 1,118 visibly in the viewport (top approximately 468px, height 90px in the inspected phone viewport). Bounded context disables automatic page appending and renders actual row heights to keep that jump stable.
- A real ZCode transcript rendered recorded provider `builtin:zai-start-plan` and observed model `GLM-5.3-Flash` separately, with conversation/tool filters and readable redacted content.

## Color and scope limits

Source-token contrast checks for body, muted, dim, accent and semantic text were above 4.5:1 on their specified surfaces in both themes. The final browser confirmed actual metric heading colors and tinted backgrounds; the lowest new heading ratio was approximately 5.03:1 in light mode. Meaning is also carried by labels and icons.

This is a bounded visual/interaction QA pass, not an exhaustive assistive-technology certification. Screen-reader operation, physical touch-device operation, color-vision simulation, and actual 200% browser zoom were not separately exercised. Compact legacy table/chart annotations remain; there was no unrelated global redesign.

The first final-copy test run failed three assertions against the old labels. Those assertions were updated to the new copy without removing checks; the affected 21 tests and the full suite then passed. Typecheck, lint, production build and Impeccable detector passed; the detector returned no findings.

## Performance

Current API/reader measurements are recorded in docs/interactive-analytics-transcripts.md. Observed browser/tool roundtrips included approximately 97ms to pin a period and 1,700ms for the 1,788-turn search, including the 250ms debounce. These include tool overhead and are not pure browser timings. No matched pre-change browser workload exists, so no improvement percentage is claimed.
