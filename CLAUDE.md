# NCODE.md

This file provides guidance to NCode when working with code in this repository.

## What this is

OpenEval — an evaluation suite that runs cases headless against **any** agent CLI harness (ncode, Claude Code, Codex, or descriptor-driven harnesses), grades each case with weighted multi-strategy graders, persists results to SQLite, and serves a live Next.js dashboard.

## Commands

```bash
npm install                          # setup
npm run dev                          # dashboard at :3000
npm run build && npm start           # prod build/serve
npm run typecheck                    # tsc --noEmit (no emitted JS in this repo)
npm run lint                         # next lint

# Tests — Node built-in runner, no jest
npm run test:live                    # tests/live.test.ts (live trace parsing + API)
npm run test:telemetry               # tests/telemetry.test.ts
node --import tsx --test tests/live.test.ts                  # run one file
node --import tsx --test --test-name-pattern="redact" tests/live.test.ts  # one test

# Running evals
npm run run:case -- swe-fix-fizzbuzz                         # single case
npm run run:eval -- --runner headless --parallel 4          # full suite, 4 workers
npm run run:eval -- --category agentic-swe --tag bugfix     # filtered
npm run run:eval -- --harness claude-code --harness codex --samples 3  # cross-harness, pass@k
npm run selftest                                             # internal sanity checks
npm run audit:accuracy                                       # case-coverage audit (strict mode exits nonzero on weakness)
```

CLI exits nonzero: `2` = runner crash, `3` = grader crash, `1` = other error. Node >= 20 required.

## Architecture

### Execution flow

`cases/*.case.json` → `selectCases()` (`lib/cases.ts`) → `createAndStartRun()` (`lib/run.ts`) → `runLoop()` fans out to N parallel workers → `executeCase()` (`lib/executor.ts`) per (case, sample) → `prepareWorkdir() → runner.run() → grade → persist`. Runs execute in a background promise started by `POST /api/runs`; both CLI and API share `createAndStartRun`.

### Adapter system — the core abstraction

`HarnessAdapter` (`lib/adapters/types.ts`) decouples runners and graders from any specific CLI. Each adapter implements `buildCommand(ctx)` (bin + args + env) and `parseLine(line, acc)` (stream → `RunnerEvent`s + `RunnerResult`). Everything else is adapter-agnostic.

- **Built-ins** (`lib/adapters/stream-json.ts`): `ncode` (default), `claude-code`, `codex` (`lib/adapters/codex.ts`).
- **Descriptor-driven** (`harnesses/*.harness.json`, loaded by `lib/adapters/loader.ts` → `makeGenericAdapter` in `generic.ts`): field-mapping spec claims a JSONL/jsonl format declaratively. See `harnesses/hermes.harness.json` for the shape.
- **Discovery** (`lib/adapters/discover.ts`): probes `PATH` + `wellKnownPaths` per adapter, runs `<bin> --version`, caches results. `--list-harnesses` prints the table.

Runners (`lib/runner/headless.ts`, `tmux.ts`) call `getAdapter(ctx.harness)` → `buildCommand` → `spawn` → feed each stdout line through `parseLine`. The `rubric_llm` grader reuses this same path via `runJudge()` (`lib/grader/judge.ts`) with a *separate* judge harness — never the harness under test.

To add a harness: drop a `harnesses/<id>.harness.json` (for JSONL-output CLIs) or register a `HarnessAdapter` in `lib/adapters/registry.ts` (needs custom parsing).

### Graders

`lib/grader/index.ts` is the registry: 14 grader types covering exit codes, tests (TAP-style parse), file content/existence/equality, regex against final_text/stdout/transcript, JSON path equality, files-unchanged (sha256 against fixture baseline), git-diff patterns, checksums, step-shape checks on the tool-call trace, and `rubric_llm` (LLM judge). Each spec carries optional `weight`; the case passes when weighted ratio meets `pass_threshold` (default 1.0). A `forbidden: true` grader that fails fails the whole case regardless of threshold.

`lib/accuracy.ts` maps grader types to evidence tiers (deterministic / trace / visual / llm_judge / manual) and audits per-case weaknesses (missing oracle, no known-bad rejection, LLM judge without deterministic backstop). `npm run audit:accuracy` surfaces this; `--strict` exits nonzero on any weakness.

### Live trace intelligence

`lib/live.ts` scans on-disk JSONL transcripts produced by running harnesses and renders the `/live` dashboard. Sources: `~/.ncode/projects/` (ncode, default), `~/.codex/sessions/` + `archived_sessions/` (codex), or `liveTrace.roots` declared in a `*.harness.json`. Every metric carries provenance — `measured` / `inferred` / `missing` / `malformed` — rather than presenting absent values as zero. It also extracts trace-graph counts (root vs sidechain messages, agents, orphans), tool reliability, queue/interruption flow, touched files, and branch/permission modes. Paths are redacted in the UI via `lib/redaction.ts` (usernames → `[redacted]`) while raw paths remain server-side for transcript lookup.

### Persistence

SQLite (`data/eval.db`, better-sqlite3, WAL mode, 15s busy timeout). Tables: `runs`, `run_cases` (one row per case×sample, includes embedded `case_def_json`, `runner_result_json`, `grader_result_json`), `events` (append-only feed used by dashboard polling). Schema migrates via `ALTER TABLE` add-column on startup (`lib/db.ts`). Workdirs under `data/workdirs/<runId>/<caseId>__s<sample>/`; transcripts as NDJSON under `data/transcripts/`. The last 5 workdirs are kept, older ones pruned after a run.

### Case files

`cases/<category>/<id>.case.json` — validated by zod schema in `lib/cases.ts` (schema is the source of truth for `CaseDefinition` in `lib/types.ts`; cached per-process, `loadCases({force:true})` to refresh). Categories: `agentic-swe`, `single-tool`, `reasoning`, `visual-code`. `setup.fixture` copies `fixtures/<name>/` into the workdir; `setup.init_git` commits a baseline so `git_diff_contains` / `files_unchanged` graders work.

## Conventions

- TypeScript everywhere; `tsx` for runtime, no compiled output. `npm run typecheck` before committing.
- Tests target Node's built-in `node:test` + `node:assert`. No jest, no vitest.
- The harness-under-test binary must be on `PATH` (or set `NCODE_BIN` for the ncode adapter). `npm run run:eval -- --list-harnesses` shows what's available.
- Grader shell commands run via `bash -lc` with `cwd=workdir` and inherit `process.env` plus `spec.env`. Default 30s timeout; set `timeout_ms` for slow test suites.
- `rubric_llm` judge routing: `judge_harness` from spec, else `JUDGE_HARNESS` env, else `claude-code`. `judge_model` similarly falls back to `JUDGE_MODEL`.