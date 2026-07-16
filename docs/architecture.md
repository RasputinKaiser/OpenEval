# Architecture

OpenEval is a local-first Next.js dashboard plus a TypeScript evaluation runner. Source of truth lives in case JSON, harness descriptors, SQLite rows, and local trace files.

## Dataflow

```text
cases/*.case.json
  |
  | lib/cases.ts
  | loadCasesWithErrors -> zod validation -> selectCases(filter)
  v
selected CaseDefinition[]
  |
  | lib/executor.ts executeCase
  | prepareWorkdir(runId, caseId, def, sample)
  |   - create data/workdirs/<runId>/<caseId>__s<sample>
  |   - copy fixtures/<fixture> or git clone repo
  |   - optional git baseline commit
  v
RunnerContext
  |
  | lib/adapters/registry.ts getAdapter(harness)
  | lib/adapters/generic.ts buildDescriptorCommand
  v
{ bin, args, env, stdin }
  |
  | lib/runner/spawn.ts spawnHarnessProcess
  |   - cwd = prepared workdir
  |   - env = process.env + descriptor extraEnv
  |   - stdin written only for prompt.mode = stdin
  |   - timeout kills process with SIGKILL
  v
stdout JSON/JSONL/text lines
  |
  | adapter.parseLine(line, accumulator)
  | claude-stream-json | codex-jsonl | generic-jsonl | text
  v
RunnerEvents + RunnerResult
  |
  | lib/executor.ts
  | - append transcript event JSONL to data/transcripts/
  | - append SQLite events
  | - run graders and evaluate weighted pass ratio
  v
SQLite
  |
  | lib/db.ts
  | runs / run_cases / events
  v
Next.js pages and API routes
```

## Case Selection

`lib/cases.ts` reads only recognized category directories:

- `agentic-swe`
- `single-tool`
- `reasoning`
- `visual-code`

It validates each `.case.json` with `CaseDefinitionSchema`, sorts cases by id, and filters by case id, category, tag, and difficulty in `selectCases()`. `loadCasesStrict()` throws on the first validation error; `loadCasesWithErrors()` returns both valid cases and validation paths.

## Workdir Preparation

`prepareWorkdir()` creates a per-run, per-case, per-sample directory:

```text
data/workdirs/<runId>/<caseId>__s<sample>
```

Setup behavior:

- Missing setup or `type: "none"` leaves an empty prepared directory.
- `type: "fixture"` copies `fixtures/<fixture>` into the workdir, skipping `node_modules` and `.git`.
- `type: "git-clone"` runs `git clone --depth 1 <repo> .` in the workdir.
- `init_git: true` creates a local baseline commit with user `eval <eval@local>`.

## Adapter Registry

`lib/adapters/builtin.ts` defines bundled descriptors for `claude-code`, `codex`, and `ncode`. `lib/adapters/loader.ts` loads user descriptors from `harnesses/*.harness.json`. `lib/adapters/registry.ts` validates both through the same schema, converts descriptors into generic adapters, and then lets user descriptors override bundled descriptors by id.

The default harness is:

1. `OPENEVAL_DEFAULT_HARNESS`, when it names a registered adapter.
2. Otherwise the first registered descriptor.

Descriptor validation issues are available from `getAllDescriptorIssues()`, returned by `GET /api/harnesses`, shown on `/harnesses`, and checked by `npm run selftest`.

## Command Build And Spawn

`buildDescriptorCommand()` builds `{ bin, args, env, stdin }` from the selected descriptor and runner context. It applies `argTemplate`, permission args, context flags, case extra args, then prompt handling.

`spawnHarnessProcess()` starts the process with:

- `cwd` set to the prepared workdir
- `env` set to `process.env` merged with descriptor `extraEnv`
- stdin pipe only when the descriptor prompt mode is `stdin`
- stdout line buffering by newline
- stderr captured for failure detail
- timeout kill via `SIGKILL`

`HeadlessRunner` emits `started`, parsed events, and `finished`. If parsing never produces a result event, it returns an error result with stderr in `resultText`.

## Persistence

`lib/db.ts` creates and migrates `data/eval.db` with WAL mode when available.

Tables:

```text
runs
  id, name, status, created_at, ended_at,
  params_json, summary_json, manifest_json

run_cases
  id, run_id, case_id, case_name, category, difficulty,
  status, started_at, ended_at, workdir_path, transcript_path,
  runner_kind, runner_result_json, grader_result_json,
  evaluation_json, budget_exceeded, case_def_json,
  error_msg, seq, sample, harness_info_json

events
  id, run_id, case_id, kind, payload_json, at
```

During execution, `executeCase()` inserts the run case, appends `case_started`, tool, assistant message, grading, grader result, and case-finished events, updates the run case with runner and grader JSON, and stores transcript event lines in `data/transcripts/`.

## Dashboard And APIs

Primary pages from the app and README:

| Route | Purpose |
| --- | --- |
| `/` | Summary dashboard. |
| `/runs` | Run history. |
| `/runs/new` | New-run wizard. |
| `/runs/[id]` | Run detail. |
| `/runs/[id]/case/[caseId]` | Per-case trace and artifacts. |
| `/runs/[id]/bench` | Bench and throughput diagnostics. |
| `/runs/leaderboard` | Cross-run comparison. |
| `/runs/compare` | Side-by-side selected runs. |
| `/harnesses` | Harness discovery and descriptor issues. |
| `/accuracy` | Case quality audit. |
| `/live` | Live local trace summaries. |
| `/collection` | All sources at once: full-history totals, weekly rollups, full-text search. |
| `/collection/session` | Read-only transcript viewer for a discovered session file. |
| `/collection/timeline` | Adoption timeline, impact deltas, change points, LLM-judge refinement. |
| `/cases` | Case library. |
| `/settings` | Local settings surface. |

API routes:

| Route | Source behavior |
| --- | --- |
| `GET /api/cases` | Case list from `loadCases()`. |
| `GET /api/harnesses` | Harness discovery, default harness, availability count, descriptor issues. |
| `POST /api/harnesses` | Probe one harness id. |
| `GET /api/harnesses/leaderboard` | Harness leaderboard data. |
| `GET /api/live?harness=&limit=` | Live trace aggregate. |
| `GET /api/models?harness=` | Descriptor model aliases/discovery/default. |
| `POST /api/models` | Model id validation; current implementation accepts any non-empty id. |
| `GET /api/runs` | Recent run ids and names. |
| `POST /api/runs` | Create and start a run. |
| `GET /api/runs/[id]` | Run and run cases, with optional `lite=1`. |
| `GET /api/runs/[id]/case/[caseId]` | Full run case record. |
| `GET /api/runs/[id]/case/[caseId]/artifact?path=<filename>` | Reads a top-level artifact file from the case workdir. |
| `GET /api/runs/[id]/telemetry` | Computed run telemetry. |
| `GET /api/runs/[id]/report` | Run report (Markdown or bundle download). |
| `POST /api/runs/[id]/cancel` | Cancel a running run. |
| `GET /api/runs/[id]/events/stream` | Server-sent events from the SQLite `events` table. |
| `GET /api/collection` | Cross-source collection aggregate (totals, rollups, archive). |
| `GET /api/collection/search` | Full-text search over indexed transcripts. |
| `POST /api/collection/search/index` | (Re)build the transcript FTS index. |
| `GET /api/collection/timeline` | Adoption timeline, impact deltas, change points. |
| `GET`/`POST /api/collection/timeline/judge` | Judge status / run LLM-judge outcome refinement. |

Cross-site mutation requests are rejected in `middleware.ts` (Sec-Fetch-Site first, then an Origin/Host comparison), so the local dashboard's mutating APIs cannot be driven by a hostile web page.

The SSE endpoint polls `listEvents()` every 600 ms, starts with `retry: 2000`, sends heartbeat comments, and emits frames whose event name is the stored event `kind`.

## Live Trace Scanning

`lib/live.ts` resolves a live source from the selected harness descriptor:

1. Use the requested harness id or the default harness.
2. If the id is not registered, refresh descriptor and registry caches once.
3. If the adapter declares `liveTrace`, expand `~` roots and scan them.
4. If no `liveTrace` exists, return an unavailable aggregate with a warning.

Formats:

- `claude-projects`: reads project directories under each root and includes `.jsonl` files directly inside those project directories.
- `codex-sessions`: recursively collects `.jsonl` files up to `maxDepth` and parses Codex session records.
- `jsonl-dir`: recursively collects `.jsonl` files up to `maxDepth` and parses generic/Claude-like records, using descriptor field mappings when available.

The live aggregate reports source status, source roots, session counts, usage summaries, token/cost coverage, data quality, model/tool/file/branch summaries, stale sessions, scan warnings, and recent sessions.

Metric provenance is explicit: each live session marks model, tokens, cost, duration, and turns as `measured`, `inferred`, `missing`, or `malformed`.

## Collection, Timeline, and the Live Cache

The Collection subsystem (`lib/insights/*`, `lib/live-cache.ts`) extends live scanning from "recent sessions" to full local history across every parseable source.

`data/live-cache.db` is a persistent SQLite cache with four jobs:

- `session_cache`: parsed sessions keyed by `(file, mtime, size)` and stamped with `PARSER_VERSION` (`lib/live-cache.ts`). The contract: bump `PARSER_VERSION` whenever the parser's output changes shape or semantics — stale-version rows are ignored and re-parsed. `tests/golden-parse.test.ts` pins parser output on synthetic fixture transcripts so a behavior change (and therefore a version bump) is a conscious choice, not an accident. Cached parses of files later pruned from disk surface as archived sessions, so history survives harness log rotation.
- `outcome_judgments`: LLM-judge verdicts per session, stamped with the `prompt_version` (`JUDGE_PROMPT_VERSION` in `lib/insights/judge.ts`) they were produced under, so re-judging after a prompt change is detectable.
- `judge_failures`: a retry ledger for judge runs. Failures persist with an attempt count; after `MAX_JUDGE_ATTEMPTS` (3) a file is skipped. Missing files and sessions with no extractable text are recorded as permanent failures. `judgeSkipSet()` unions already-judged and dead files so judge sweeps never spin on the same broken input.
- A full-text (FTS5) index over transcript conversational text, backing `/collection` search.

Judging uses the same backend chain as the `rubric_llm` grader (`resolveJudge()`: explicit `JUDGE_HARNESS`/`JUDGE_MODEL`, then the local `/settings` selection, then OpenRouter when a key exists, else the Codex CLI), and session parsers drop any session whose first user text starts with the judge-prompt marker — the judge's own CLI sessions are instrumentation, not user work.

The Timeline (`/collection/timeline`) derives adoption markers (skills, MCP servers, subagents, models) from parsed sessions, computes before/after impact deltas with confound flags, and detects metric change points. Heuristic outcome scores can be refined by persisted judge verdicts.

The whole cache file is disposable — deleting `data/live-cache.db` only forces a re-parse.

## Local Data Layout

Source-backed runtime paths from `lib/config.ts`:

```text
data/eval.db
data/eval.db-wal
data/eval.db-shm
data/live-cache.db
data/workdirs/
data/transcripts/
data/reports/
```

`ensureDirs()` creates `data/`, `data/workdirs/`, and `data/transcripts/`. `data/reports/<runId>/` is the default output directory for `npm run report -- <runId> --bundle` (report.md, manifest.json, summary.json, and per-case JSON artifacts). The README also treats `data/` as the ignored local runtime area for SQLite, transcripts, workdirs, and artifacts.
