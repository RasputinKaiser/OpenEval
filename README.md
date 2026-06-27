# NEval

A full evaluation suite for the NCode CLI — branded NEval — runs cases headless against `ncode`, grades each against multi-strategy graders, persists everything to SQLite, and serves a live web dashboard.

## What it tests

Three case categories live in `cases/`:

- **`agentic-swe`** — multi-step software tasks against real small repos (bug fixes, refactors, feature additions). Exercises the full tool loop: Read, Grep, Edit, Bash(`npm test`).
- **`single-tool`** — narrow tasks isolating one tool (Write, Read, Grep/Bash). Deterministic assertions.
- **`reasoning`** — knowledge/trace/math prompts with no tools required. Regex-based final-answer grading.

Each case ships with one or more **graders** from the registry in `lib/grader/index.ts`:

| grader          | what it checks                                                    |
| --------------- | ---------------------------------------------------------------- |
| `exit_code`     | runs a shell command, passes if exit 0                            |
| `tests_pass`    | runs a command, parses TAP output for pass/fail counts            |
| `file_contains` | regex match against a file                                       |
| `file_exists`   | stat check (or `negate: true` for absence)                       |
| `file_eq`       | exact content match (with optional trim)                         |
| `regex_match`   | regex against `final_text`, `stdout`, or full `transcript`       |
| `json_path`     | JSON parse + dotted-path equality                                |
| `rubric_llm`    | spawns a second NCode call as an LLM judge against a rubric       |
| `manual`        | parked for human review                                          |

Graders carry optional `weight`s; the case passes when the weighted ratio meets `pass_threshold`.

## Setup

```bash
npm install
```

Requires `ncode` on `PATH` (or set `NCODE_BIN=/path/to/ncode`). Node ≥ 20.

## Running evaluations

### Web dashboard (recommended)

```bash
npm run dev
open http://localhost:3000
```

- **Dashboard** (`/`) — recent runs, summary stats, case library breakdown.
- **Runs** (`/runs`) — full history table with cost, tokens, status.
- **New Run** (`/runs/new`) — pick a runner, parallel workers, filter by category/tag, or hand-select cases. Click Start.
- **Run detail** (`/runs/:id`) — split-pane view: case list on the left, live tool calls + graders + final answer on the right. Polls every 1.5s while the run is in flight.
- **Case detail** (`/runs/:id/case/:caseId`) — full transcript with collapsible tool calls and grader output.
- **Cases** (`/cases`) — library browser with category filters.

Runs are submitted via `POST /api/runs` which kicks off execution in a background promise and returns immediately. State is durable in SQLite (`data/eval.db`); transcripts stream to `data/transcripts/`, cropped workdirs live in `data/workdirs/`.

### CLI

```bash
# single case
npm run run:case -- swe-fix-fizzbuzz

# full suite, 4-way parallel, headless
npm run run:eval -- --runner headless --parallel 4

# slice by category/tag
npm run run:eval -- --category agentic-swe --tag bugfix
```

The CLI prints live progress and exits with a summary. It writes to the same SQLite DB the dashboard reads.

## Adding cases

1. Drop a small repo into `fixtures/<name>/` (if the case needs one). Cases that need no code boilerplate skip the `setup.fixture` field.
2. Create `cases/<category>/<id>.case.json`:

```jsonc
{
  "id": "swe-fix-fizzbuzz",
  "category": "agentic-swe",
  "name": "Fix the FizzBuzz bug",
  "tags": ["bugfix", "node"],
  "prompt": "There is a bug in src/fizzbuzz.js …",
  "setup": { "type": "fixture", "fixture": "fizzbuzz-repo" },
  "runner": {
    "max_turns": 18,
    "timeout_seconds": 240,
    "permission_mode": "bypassPermissions"
  },
  "graders": [
    { "type": "tests_pass", "command": "npm test" },
    { "type": "file_contains", "path": "src/fizzbuzz.js", "pattern": "FizzBuzz" }
  ],
  "pass_threshold": 1.0
}
```

3. The case loader validates the schema with zod (`lib/cases.ts`) and caches for the process.

## Runners

Both implement the same `Runner` interface (`lib/runner/types.ts`):

- **`HeadlessRunner`** — `child_process.spawn`s `ncode -p --output-format stream-json --permission-mode …` in the per-case workdir. Parses the streaming NDJSON into transcript entries, tool-use blocks, and a final `result` event with usage/cost. Default.
- **`TmuxRunner`** — same command, but inside a named `tmux new-session`; polls `capture-pane` for live output and lets you `tmux attach -t eval-…` to watch a case run.

Switch via `--runner tmux` or the New Run page.

## Project layout

```
app/                Next.js App Router — pages + API routes
  api/runs/          POST create / GET list+detail / GET case / SSE-style events
  runs/[id]/         run detail + per-case transcript page
  runs/new/          new-run wizard
  cases/             library browser
components/         React client components (live polling, transcript viewer, sidebar)
lib/
  config.ts         paths (DB, workdirs, transcripts, ncode bin)
  db.ts              better-sqlite3 schema + accessors
  types.ts          CaseDefinition, GraderSpec, RunnerResult, RunCaseRecord
  cases.ts          case loader + zod schema
  runner/           HeadlessRunner, TmuxRunner, stream-json parser
  grader/index.ts   grader registry + weighted evaluation
  executor.ts       prepareWorkdir → run → grade → persist
  run.ts            createAndStartRun (used by both API and CLI)
  summary.ts        per-run aggregate stats
  cli/run.ts        CLI entrypoint
cases/              *.case.json definitions
fixtures/           small repos copied into per-run workdirs
data/               runtime state (gitignored): eval.db, workdirs/, transcripts/
```

## Scripts

| script                  | purpose                              |
| ----------------------- | ------------------------------------ |
| `npm run dev`           | Next.js dev server (dashboard)       |
| `npm run build`         | production build                    |
| `npm start`             | serve production build               |
| `npm run typecheck`     | tsc --noEmit                        |
| `npm run run:eval`      | run the suite via CLI                |
| `npm run run:case -- X` | run a single case                   |