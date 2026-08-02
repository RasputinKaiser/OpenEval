# Observation Ingestion and Semantic Normalization

## Existing Contract to Preserve

- Raw external transcript files are read-only sources; derived summaries, list payloads, FTS text, and rendered windows remain bounded.
- Discovery reports discovered/scanned/parsed/dropped/unscanned/archived/partial/truncated counts rather than implying full coverage.
- Codex supports legacy and current JSONL shapes, mirror deduplication, judge-marker filtering, tool pairing, usage, errors, and child lineage.
- Claude/ncode support conversation, tool, usage, graph, skills, MCP, queue, file, permission, and outcome signals.
- `PARSER_VERSION` and `FTS_INDEX_VERSION` must change when their persisted observable projection changes.

## Raw Authority for OpenEval-Launched Runs

The runner transport retains bounded raw stdout and stderr records before adapter parsing. The run case stores:

- a raw-output artifact/reference with byte count, hash/revision, capture completeness, stream identity, and truncation/write-error status;
- the existing normalized runner events as a derived projection;
- the adapter/harness/model/session ID and timestamps needed to relate both views.

Raw capture must not place unbounded process output in memory. It streams to the run evidence directory, uses bounded line/chunk handling, and makes persistence failure an infrastructure/evidence error rather than allowing an unrepeatable pass. Redaction remains display-only; the local raw file is not rewritten.

SQLite and overview/list/Compare APIs retain only bounded projections and stable raw-source references. They do not duplicate complete transcript/tool arrays across `runner_result_json`, `evaluation_json`, and filesystem evidence. Existing rows remain readable through an explicit migration/compatibility path, and on-demand detail hydration never changes authoritative bytes.

Externally discovered harness files remain authoritative while present. When pruned, the UI states that only an archived derived summary remains. Automatic copying of every external source is out of this release.

## Universal Semantic Mapping

The descriptor-driven promise extends beyond process launch. One source-aware normalization contract feeds runner events, Live/Collection summaries, transcript turns, and bounded FTS extraction.

Existing descriptor mappings for final text, session/model, tool call/result/error, usage, duration, turns, stop reason, and run error work consistently in all four paths. The descriptor schema gains optional mappings needed for user/assistant text and role, timestamp, reasoning/thinking, parent/child lineage, attachments, and event severity when the source is generic.

Unknown mappings remain absent/unknown; they are never guessed as zero. Tool calls/results retain bounded call IDs, arguments, output, status, error, and duration. Reasoning retains only bounded source-aware display/search projections and encrypted/unavailable markers, never hidden raw chain-of-thought claims.

## Parser and Cache Bounds

- Claude/ncode maps, tool-duration samples, file/activity sets, permission modes, lineage, and other transcript-controlled cardinalities use explicit caps matching the Codex partial-detail policy.
- Giant newline-free records cannot grow an unbounded leftover buffer; skipped/truncated bytes and records emit an explicit warning.
- Built-in reasoning aliases have summary/detail/search parity; current dirty-tree normalization is reused.
- Parsed-session cache rows persist a bounded content identity strong enough to detect same-stat head/tail rewrites across process restarts. The chosen fingerprint limitations are documented rather than called complete content proof.
- Unchanged cache and FTS rows remain read-only/no-op paths.

## Tests

- Raw capture fixtures prove stdout/stderr authority, normalized projection separation, hashes/revisions, truncation, cancellation, persistence failure, and restart readability.
- Large-run fixtures prove bounded SQLite rows and that list, overview, `lite=1`, and Compare responses omit transcript bodies while on-demand detail remains available.
- Generic descriptor fixtures prove the same conversation/tool/error/reasoning/usage/lineage evidence across runner, summary, transcript, and FTS paths.
- Golden Codex/Claude/ncode fixtures preserve mirror deduplication, `JUDGE_PROMPT_MARKER`, model provenance, and tool pairing.
- Adversarial cardinality and giant-record fixtures prove bounded memory/detail plus explicit partial warnings.
- Cache tests cover parser/index versioning, same-stat rewrite after restart, archived stale-parser provenance, and no-op hits.
