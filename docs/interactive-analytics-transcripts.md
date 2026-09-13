# Interactive analytics and transcript sources

Local implementation, September 12, 2026. Data-rich routes now use the available viewport width instead of a narrow centered maximum; transcript prose retains a reading-width limit. Existing OpenEval colors, cards, motion tokens and table alternatives remain the visual reference. The supplied ChatGPT screenshot informed date controls and source/model grouping, not chart data.

## Interaction contract

The shared date controls provide 7 days, 30 days and explicit UTC dates. The end date is inclusive in the control and exclusive in the URL/API. Daily usage buckets use UTC too, including zero-activity gaps between observed dates. Hover or focus displays values; click, tap, Enter or Space pins inspection. Explore applies the selection or opens matching Collection sessions. Escape and Clear inspection dismiss inspection. Selection chips, reset and browser history retain analysis context. Direct session links navigate immediately and carry the originating filters where available.

Dashboard usage uses chronological session activity, stacked token composition, separate provider-reported and API-equivalent cost series, and ranked model/source activity. The Collection period chart uses the same time-series component. Missing values remain unavailable; transcript tokens cannot establish subscription usage percentages. Global dashboard headline cards describe the full corpus; usage controls filter the Usage and activity section.

## Transcript contract

The source-qualified transcript endpoint retains existing pagination. `q` accepts 1–256 characters and searches one bounded semantic window per request. Responses include matches with absolute semantic indexes, excerpts and signed window references, scanned-turn progress, completion, truncation and continuation. The client automatically scans up to 40 windows or 240 matches, then offers continuation. Superseded requests are cancelled. Selecting a result loads its window and anchors the exact turn. Recorded reasoning remains separately labelled; tool content expands on demand, and call identifiers can locate paired events beyond the loaded window.

Cursors bind source, session, descriptor, parser version and file revision. Database revisions include WAL changes. Changed revisions return an explicit stale response. Compound records crossing a 240-turn page boundary are replayed with a candidate checkpoint to avoid losing remaining blocks. Message content is no longer reduced to the old 420-character preview; the existing 4 MiB source-record limit still applies, with an 8 MiB budget for streaming windows. Search snippets redact the complete source text before excerpting, using the existing redaction rules; this prevents slicing away a credential or username prefix before it can be recognized. Raw source files are never rewritten.

## Source coverage

| Source | Verified format | Implemented coverage | Explicit limits |
| --- | --- | --- | --- |
| Kimi Code | Per-agent `wire.jsonl`, Kimi CLI source revision `86f136422a0aae6b217ea49e7ea1d2e8a1defcd2` | User text, streamed text, recorded thinking, tool calls/results; parent/agent identity from documented directories and version-checked state titles | Status/request snapshots are metadata; usage is not summed from repeated snapshots. Incremental tool argument fragments require further normalization. |
| DeepSeek Harness | Plaintext `session.v3.jsonl`, source revision `c291e7961a515f6d7af9304e7fd1d257929aef26` | Settled assistant messages, user messages, tool calls/results, disjoint usage fields, recorded model | Unknown required events reject summary parsing. Compressed Zstandard storage and historical surface-edit reconstruction are unsupported. Set `OPENEVAL_DEEPSEEK_ROOT` to the harness persistence root (the upstream backend has no default), or add a custom source. |
| ZCode | Locally observed 0.16.3 / 0.16.5 `cli/db/db.sqlite` v1 session/message/part schema | Read-only conversations, recorded reasoning, tools, separate recorded provider/model identity and assistant token totals; parent session links | Source cost is not assumed to be billing. Attachment references are labelled unavailable. |
| OpenCode | v1 session/message/part schema, source revision `95daf90670b7c039c436c85537da5fbfe2205b41` | Same database projection, with schema checks and fixtures | Newer v2-only storage is unsupported. Schema compatibility is required; provider branding does not establish compatibility. |
| Grok Build | Markdown exporter, source revision `37949780c144e37df692e3d669051a21fec24f20` | User/assistant sections and readable Tools sections, including fenced code | Usage, timestamps, model and structured tool metrics remain unavailable. Native store stays detect-only. |
| Z.AI through other tools | Existing supported host formats | Observed GLM model identity stays attached to its actual host source | Configured aliases do not prove the observed model. |

Database sessions are limited to 32 MiB of message/part JSON and 20,000 messages per read; Grok exports to 32 MiB and 4 MiB per section. Unsupported database schemas fail visibly. Source adapters provide collection/transcript evidence; the separate experimental evidence-judge extractor does not yet understand these new native formats.

Primary references: [Kimi sessions](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/sessions), [DeepSeek Harness](https://www.deepseek.com/harness/en/), [ZCode agents](https://zcode.z.ai/en/docs/agents), [ZCode usage](https://zcode.z.ai/en/docs/usage-stats), [OpenCode source](https://github.com/anomalyco/opencode), [Grok CLI](https://docs.x.ai/build/cli/reference).

## Verification record

Ten dedicated fixture tests cover compound page boundaries, long-message tails, search beyond page one, exact context, stale revisions, cross-session cursor rejection, native format projection, token duplicate prevention, WAL changes and UTC date boundaries. Existing long-reasoning assertions now require retained text. Parser version advanced from 24 to 25.

Full test suite exited successfully. Focused transcript/source tests: 10 passed; combined transcript/analysis regressions: 15 passed. Typecheck and lint passed. Selftest: 71 passed, 0 failed, 14 paid LLM-judge checks intentionally gated. Strict accuracy audit passed deterministic/oracle/known-bad checks; runtime trace, visual contract and LLM-judge evidence remain Unknown where no such evidence was supplied. Production build completed; final browser review is recorded separately in design-qa.md.

The evidence benchmark is a current-workload measurement, not an improvement claim: 400 synthetic turns, initial-window median 2.562 ms, continuation median 1.929 ms. Concurrent compilation affected aggregation timings. No matched before/after browser timing comparison has been established.


## Impeccable refinement

Clarify: Collection navigation names its destinations; last activity over 12 hours is labelled as historical rather than a warning; the estimate names published API rates. Shared chart details use Methodology so they are distinct from selection-to-evidence Explore actions. Accuracy, Compare and Timeline introductions use concrete evidence language.

Colorize: the existing violet interaction palette remains. Collection inventory headings use a theme-owned teal, API-equivalent estimate headings use amber, and tool activity uses violet. Labels and icons carry the meaning independently of color. The light-theme amber was darkened for contrast. Source-token contrast checks for foreground, muted, dim, accent, informational and status text exceeded 4.5:1 on their specified surfaces in both themes; rendered checks are in design-qa.md.

Typeset: page headings use 24px semibold, subtitles and chart headings 16px, chart descriptions 14px, and key collection labels/details 12px. Measurements retain tabular monospace; explanatory text uses the existing system sans stack. Transcript prose uses 16px/28px and a 72ch measure; code keeps its own scrollable, monospaced treatment. No font assets or network requests were added. Dense table and chart annotations retain their compact roles.

The Impeccable type scan and final detector returned no findings. Three existing copy assertions were updated to the clarified labels; the affected 21-test regression and full suite passed afterward. No tests were removed or relaxed.
