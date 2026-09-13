# Interactive analysis

This local branch adds connected evidence exploration across Observe and Evaluate while preserving OpenEval's charcoal/light themes and violet accent.

## Behavior

- Collection computes filters and summaries over the complete parsed snapshot. Its matching-session table is bounded to 80 rows per page, with a generation check to prevent mixing snapshots. Source/model/tool, date, local weekday/hour and metric-bin selections are URL-backed.
- Timeline carries those selections into its report, offers explicit before/after ranges, preserves outcome/cost provenance and source-qualified transcript links, and groups dense scatter points into inspectable targets. Missing and zero cost remain separate from the positive logarithmic plot.
- Dashboard periods link into Timeline. Live daily usage links to dated sessions and tool-failure bars filter the retained session slice.
- Compare adds outcome-transition selection and case/sample metric deltas. Runs adds status and distribution exploration; run details link timeline/status selections to exact case/sample evidence. Accuracy links coverage states to the proof matrix.
- Leaderboard adds workload composition and metric-coverage tables with retained-run references. Its population remains capped at the latest 200 runs, disclosed alongside the total run count.
- Shared chart frames provide evidence metadata, accessible tables, keyboard inspection, explicit Explore actions, responsive containers and reduced-motion behavior. Supporting workflow forms received narrow overflow and label hardening.

## Verification on 2026-09-11

- Full `npm test`: passed (801 passing dot-reporter results).
- `npm run typecheck`, `npm run lint`, and public-upload audit: passed.
- `npm run doctor`: healthy; Node 22 differs from `.nvmrc` 20, but the native SQLite binding loads and database check succeeds.
- Self-test: 71 pass, 0 fail; 14 LLM-judge checks skipped. No new model or judge jobs were run.
- Strict accuracy command: exit 0. Deterministic, oracle and known-bad evidence passed; the overall audit remains Unknown because trace, visual and LLM runtime proof is not attached.
- Impeccable static detector: found one width transition in shared bars; removed it. No second detector scan was used.
- Chrome checks: verified 390, 768, 1440 and 1920 CSS-pixel layouts on representative routes; inspected light/dark and reduced-motion rendering. A 2x page-magnification check was performed; it is not browser text-zoom reflow certification.
- Interaction checks: Collection source selection returned 879 matching sessions, paging changed 80 to 160 loaded rows without changing the denominator, a future-date selection returned zero, and browser Back restored the source filter. Timeline retained the source in its URL/report. Leaderboard Explore populated the selected workload and run links. Compare's passed-to-failed selection filtered four case/sample pairs to the matching two and persisted both run IDs and the transition in the URL.

## Performance boundary

Fixed-workload measurements and raw results are recorded in `.optimize/ledger.md`. The expanded charts add capabilities and were not a measured speed win. A full-population analysis experiment reduced process time by about 0.82 seconds but failed the configured two-second noise threshold, so it was reverted. No runtime interaction-speed claim is made from server-render timings.

Final review found and resolved mixed-workload Leaderboard headline/model ambiguity, shared Explore action grammar, and comparison ranges that could escape the parent date selection. A focused boundary regression test covers inclusive limits, escaped dates and open-ended ranges. Production `npm run build` passed, including type and lint checks. The production server was started on port 3000; Chrome confirmed the revised Leaderboard workload/model copy and persisted harness profile, and the saved-date guard displayed its explicit warning for an out-of-bounds range.

Valid before/after periods also loaded in production. The first attempt detected a snapshot changing between requests and offered Retry; retry produced both period reports with no alert, preserving the generation boundary. Browser overrides were reset after inspection.
