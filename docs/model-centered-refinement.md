# Model-centered OpenEval refinement

The supplied Models table is the visual anchor. Collection now places that explorer directly after its summary and before coverage diagnostics. Existing model names, monospaced values, pricing evidence, share bars and full-table access are retained.

Ranking controls select both the sort and bar metric: API-equivalent estimate, sessions, input/output tokens, cache reads, tool calls or tool error rate. Shares use the full all-time model population; filtering the visible names does not change the denominator. Error-rate bars use failed calls divided by each model's total calls. The highest-error highlight discloses counts and the existing minimum of ten calls. Unpriced cost shares are unavailable rather than zero.

Model names and headline names open a bounded model inspection using the existing analysis endpoint. It shows chronological activity, contributing sources, cost coverage and five recent source-qualified session references. A date bucket or source can be explored explicitly in Collection. Inspection is all-time, labelled as such, and does not silently reinterpret the table using unrelated analysis filters.

Phones default to model name, active metric and bar; All columns reveals the existing horizontally scrollable full table. No values are removed from the full table.

Compare now places experiment saving/history after comparison results in an expandable section. Accuracy places calibration after its audit results. Session detail keeps the brief and its limitations available in a disclosure while the conversation remains primary. The loaded-window filter is explicitly named separately from whole-session search.

Browser inspection exposed a model-attribution mismatch: the table included secondary models in mixed-model sessions, while the analysis filter checked only the primary model. The filter now uses the same attributed model identities. This changes which whole sessions match; it does not relabel all usage inside a mixed-model session as belonging to the selected model. The inspection explains that its coverage describes whole sessions.

The aggregation fix also removes a duplicate priced-session increment and keeps provider-reported zero cost distinct from unavailable cost. Dedicated fixtures cover both cases and mixed-model matching. Share bars no longer impose a minimum fill that visually inflated small values. Compact cost values retain the same estimate marker rules as the full table.

Verification: dedicated model-ranking tests cover conservation for cost/session/token/cache/tool shares and per-model error rates. The focused ranking and analysis suite passed 9/9; the full test suite passed. The design detector returned no findings and the public-upload audit passed. The final production build (`OPENEVAL_BUILD_DIR=.next-interactive npm run build`), then standalone typecheck and lint, passed. An earlier typecheck raced generated Next types; the successful final standalone run occurred after the build completed.

Production Computer Use confirmation:
- Models table, inspection, and matching-session results each showed 446 gpt-5.5 sessions. The previous inspection showed 444. Source contributions now sum to 446 (313 Codex, 133 Hermes).
- Enter opened model inspection; Explore carried `vizModel=gpt-5.5` into analysis. A source-qualified session link reached a rendered conversation with a collapsed brief and separately labeled whole-session and loaded-message searches. Browser Back restored the model-filtered analysis URL.
- Desktop and narrow screenshots retained the existing table and violet chart treatment. Narrow compact columns showed Model, active metric and Share; All columns restored the full horizontally scrollable table. Document overflow was zero. Mobile emulation initially produced a scaled capture, so the reliable narrow screenshot used a 390px desktop viewport override; this is responsive-layout proof, not a physical-device touch test.
- Light-theme model inspection rendered with reduced motion enabled; Escape closed it. Compare experiments and Accuracy calibration were initially collapsed. All temporary viewport/media overrides were cleared and the dark theme restored.

Local production preview is running on port 3177. No publication or performance-improvement claim is made in this pass. Existing dense pricing annotations remain a possible future typography refinement; this pass retained their current component styling.
