Developed primarily with Noumena Code, Claude Code (Fable 5, Sonnet 5), OpenAI Codex (GPT-5.5)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/W7W7C9TC7)

# OpenEval

OpenEval is a local-first, harness-agnostic evaluation dashboard for agent CLIs. Every harness is a JSON descriptor; the bundled Claude Code, Codex, and ncode adapters use the same format as user descriptors under `harnesses/`. OpenEval runs repeatable cases, grades results with deterministic and rubric-based checks, persists run history to SQLite, and turns the results into an operator-friendly Next.js dashboard.

The project is designed for people who want to compare agent behavior on practical software tasks, inspect the exact traces behind a score, and keep their private run history on their own machine.

Repository: [RasputinKaiser/OpenEval](https://github.com/RasputinKaiser/OpenEval)

## Launch Video

[Watch the OpenEval launch video](https://github.com/user-attachments/assets/2353204b-81c9-4d63-9c22-fb7c1c19017e)

[![OpenEval launch video poster](https://github.com/user-attachments/assets/2353204b-81c9-4d63-9c22-fb7c1c19017e)](https://github.com/user-attachments/assets/2353204b-81c9-4d63-9c22-fb7c1c19017e)

## Highlights

- **Descriptor-first harnesses:** bundled `ncode`, Claude Code, and Codex harnesses plus user harnesses under `harnesses/` are all validated JSON descriptors.
- **Weighted graders:** combine shell checks, file assertions, transcript regexes, JSON path checks, trace-shape checks, git diff checks, and optional LLM rubric judges.
- **Run dashboard:** browse recent runs, pass rates, token and cost summaries, case outcomes, and per-case trace detail.
- **Live trace view:** inspect recent local CLI sessions with measured/inferred/missing/malformed provenance for usage, cost, model, duration, tool calls, and trace structure.
- **Accuracy audits:** review whether cases have deterministic proof, known-bad rejection, oracle coverage, and rubric backstops.
- **Local-first storage:** run history, workdirs, transcripts, SQLite WAL files, and personal stats live under `data/`, which is ignored by Git.
- **Fixture-based repeatability:** each case can copy a tiny repository from `fixtures/`, initialize git, run the harness, and grade the changed workdir.

## Dashboard Tour

Start the app and open the dashboard:

```bash
npm install
npm run dev
open http://localhost:3000
```

The dashboard currently exposes these primary routes:

| Route | Purpose |
| --- | --- |
| `/` | Summary dashboard with total runs, case count, latest pass rate, average tokens, recent runs, case library breakdown, and last-run metrics. |
| `/runs` | Historical run table with status, pass/fail counts, runner, cost, token, and duration information. |
| `/runs/new` | New-run wizard for choosing harness, runner, parallelism, samples, category/tag filters, and explicit cases. |
| `/runs/[id]` | Run detail page with case list, grader results, live run events, final answers, tool calls, cost, duration, and usage. |
| `/runs/[id]/case/[caseId]` | Full per-case trace with transcript entries, tool calls, grader output, and artifact links. |
| `/runs/[id]/bench` | Bench view for per-case cost, token, duration, and throughput diagnostics. |
| `/runs/leaderboard` | Cross-harness comparison by pass rate, cost, tokens, and speed. |
| `/runs/compare` | Side-by-side comparison of selected runs. |
| `/harnesses` | Harness discovery, binary availability, capabilities, version probe, and sample command display. |
| `/accuracy` | Case quality audit: evidence tiers, oracle coverage, known-bad rejection, and weak grader warnings. |
| `/live` | Live local trace intelligence from the selected harness descriptor's `liveTrace` roots, or the descriptor-driven default harness. |
| `/cases` | Case library browser with categories, tags, prompts, setup, and grader definitions. |
| `/settings` | Operator settings surface for local configuration. |

## Documentation

| Document | Purpose |
| --- | --- |
| [Harness Authoring](docs/harness-authoring.md) | Write and validate `.harness.json` descriptors. |
| [Case Authoring](docs/case-authoring.md) | Write `.case.json` cases, fixtures, runner settings, budgets, oracles, visual contracts, and grader arrays. |
| [Graders](docs/graders.md) | Understand every grader type, parameters, evidence tier, weights, forbidden checks, and pass-threshold math. |
| [Architecture](docs/architecture.md) | Follow the dataflow from case selection through workdir prep, harness spawn, parsing, SQLite persistence, dashboard routes, SSE, and live traces. |
| [Redaction](docs/redaction.md) | Layered redaction: local paths, credential shapes, and the optional on-device Rampart PII model. |

## npm scripts

| Script | Command | Purpose |
| --- | --- | --- |
| `dev` | `next dev` | Start the local Next.js dashboard. |
| `build` | `next build` | Build the production Next.js app. |
| `typecheck` | `tsc --noEmit` | Run TypeScript without emitting files. |
| `test:live` | `node --import tsx --test tests/live.test.ts` | Run live-trace tests. |
| `test:telemetry` | `node --import tsx --test tests/telemetry.test.ts` | Run telemetry tests. |
| `run:eval` | `tsx lib/cli/run.ts` | Start evaluation runs from the CLI. |
| `run:case` | `tsx lib/cli/run.ts --case` | Run one case id through the evaluation CLI. |
| `selftest` | `tsx lib/cli/selftest.ts` | Validate DB access, cases, harness descriptors/parsers, no-op baselines, and oracles. |
| `audit:accuracy` | `tsx lib/cli/accuracy.ts` | Audit case proof strength, oracle coverage, known-bad coverage, and evidence tiers. |
| `report` | `tsx lib/cli/report.ts` | Generate a Markdown run report or portable bundle (`--bundle`, `--redact`); every run also records a reproducibility manifest. |
| `test:redaction` | `node --import tsx --test tests/redaction.test.ts` | Run redaction-pipeline tests. |

## What OpenEval Tests

Cases live in `cases/` and are grouped by category.

| Category | What it exercises | Examples |
| --- | --- | --- |
| `agentic-swe` | Multi-step software edits against small repositories. These cases exercise reading files, understanding tests, editing source, and running commands. | FizzBuzz bug fix, CommonJS to ESM conversion, shape feature addition, multi-bug pipeline repair. |
| `single-tool` | Narrow tasks that isolate one tool or one tiny workflow. | Count errors, sum numbers, create README, preserve locked config. |
| `reasoning` | No-code reasoning tasks where the final answer can be checked by regex or rubric. | Code trace, recursion, word problem, proof sketch, counterfactual planning. |
| `visual-code` | Generated UI/SVG/web artifacts with deterministic contracts and preview-oriented checks. | SVG status card, web eval dashboard. |

Each `.case.json` file declares:

- identity: `id`, `category`, `name`, `description`, `tags`, `difficulty`
- prompt: the exact instruction sent to the harness
- setup: optional fixture copy and git initialization
- runner budget: max turns, timeout, model, permissions, extra args
- graders: weighted checks that decide pass/fail
- pass threshold: the weighted ratio required to pass

## Grader System

The grader registry is implemented in `lib/grader/index.ts`. A case can combine multiple graders and assign optional weights. A failed grader with `forbidden: true` is a hard failure even when the weighted score would otherwise pass.

Common grader types include:

| Grader | What it proves |
| --- | --- |
| `exit_code` | A command exited with status 0. |
| `tests_pass` | A test command passed, including TAP-style pass/fail parsing where available. |
| `file_contains` | A file matches a required regex. |
| `file_exists` | A required file exists, or does not exist when negated. |
| `file_eq` | A file exactly matches expected text. |
| `files_unchanged` | Protected files match their fixture baseline. |
| `git_diff_contains` | The final diff contains an expected pattern. |
| `checksum` | A file or artifact matches an expected checksum. |
| `regex_match` | Final answer, stdout, or transcript matches a regex. |
| `json_path` | A JSON value at a dotted path equals the expected value. |
| `step` | Tool-call traces follow expected shape, order, or count constraints. |
| `rubric_llm` | A separate judge harness grades a response against a rubric. |
| `manual` | Marks a case for human review instead of fully automated proof. |

The accuracy audit in `lib/accuracy.ts` classifies grader evidence into deterministic, trace, visual, LLM-judge, and manual tiers. Use it to identify cases that need stronger proof.

```bash
npm run audit:accuracy
npm run audit:accuracy:strict
```

## Harnesses

OpenEval separates "how to run an agent CLI" from "how to grade a case" through the `HarnessAdapter` interface in `lib/adapters/types.ts`.

Built-in harnesses:

- `ncode`: descriptor for NCode stream JSON output.
- `claude-code`: stream JSON adapter for Claude Code-compatible output.
- `codex`: adapter for Codex CLI/App session event formats.

Descriptor harnesses:

- Add `harnesses/<id>.harness.json` for CLIs that emit JSON or JSONL with stable field paths.
- The descriptor is loaded by `lib/adapters/loader.ts` and converted into a generic adapter by `lib/adapters/generic.ts`.
- `harnesses/hermes.harness.json` is the example descriptor.

Discovery:

```bash
npm run run:eval -- --list-harnesses
```

Discovery probes `PATH`, well-known paths declared by each adapter, and `<bin> --version`. The Harnesses page shows availability, version, capabilities, and the sample command OpenEval would run.

## Running Evaluations

Run one case:

```bash
npm run run:case -- swe-fix-fizzbuzz
```

Run the full suite with the default harness:

```bash
npm run run:eval -- --runner headless --parallel 4
```

Run a filtered slice:

```bash
npm run run:eval -- --category agentic-swe --tag bugfix
```

Compare harnesses with repeated samples:

```bash
npm run run:eval -- --harness claude-code --harness codex --samples 3
```

Useful flags:

| Flag | Meaning |
| --- | --- |
| `--case <id>` | Run one case id. |
| `--category <name>` | Restrict to one category. |
| `--tag <tag>` | Restrict to cases with a tag. |
| `--parallel <n>` | Number of worker slots. |
| `--samples <n>` | Repeat each selected case `n` times. |
| `--runner headless` | Spawn the harness directly. |
| `--runner tmux` | Run each harness command inside tmux for attachable observation. |
| `--harness <id>` | Select one registered harness adapter. |
| `--model <name>` | Pass a model selection through to adapters that support it. |
| `--list-harnesses` | Print harness discovery results and exit. |

CLI exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Run completed without infrastructure failure. Individual cases may still fail. |
| `1` | General error. |
| `2` | Runner crash. |
| `3` | Grader crash. |

## Local Data and Privacy

OpenEval intentionally keeps operator stats local.

Ignored runtime data:

- `data/eval.db`
- `data/eval.db-wal`
- `data/eval.db-shm`
- `data/transcripts/`
- `data/workdirs/`
- `.codex/`
- `.ncode/`
- `state.yaml`
- `tsconfig.tsbuildinfo`

This means you can make a public GitHub repository without publishing local run history, traces, private machine paths, or personal dashboard totals. Your dashboard will still keep using the existing local `data/` directory as long as you do not delete it.

The fixture files under `fixtures/` may contain intentionally fake secret-like strings, such as `API_KEY=prod-secret-12345`, because some cases test whether an agent preserves protected files instead of deleting or leaking them. Treat those as adversarial test data, not credentials.

Run the public upload audit before publishing:

```bash
bash scripts/public-upload-audit.sh
```

The audit checks for tracked local-only files, the disallowed public-facing identity string, private machine paths, and an inventory of secret-like fixture files that should be reviewed when fixtures change.

## GitHub Project Hygiene

The repository includes public-facing GitHub scaffolding:

- `CONTRIBUTING.md` for local setup, contribution areas, case quality expectations, and pull request checks.
- `SECURITY.md` for private vulnerability reporting and local-data boundaries.
- `SUPPORT.md` for synthetic reproduction guidance.
- `.github/pull_request_template.md` for verification and privacy checks.
- `.github/ISSUE_TEMPLATE/bug_report.yml` for public-safe bug reports.
- `.github/ISSUE_TEMPLATE/evaluation_case.yml` for case and grader proposals.

OpenEval is open source under the [MIT License](LICENSE).

## Launch Video Source

The repository includes a HyperFrames source composition for an OpenEval launch/demo video:

```bash
cd media/openeval-launch
npm install
npm run check
npm run dev
```

The composition lives in `media/openeval-launch/index.html`, with visual identity notes in `media/openeval-launch/DESIGN.md`. Its npm scripts pin project-local FFmpeg/FFprobe binaries so renders do not depend on a machine-specific Homebrew encoder install. Generated preview, inspection, and render output should stay local.

## Project Layout

```text
app/                         Next.js App Router pages and API routes
app/api/runs/                run creation, run detail, case detail, telemetry, events
app/api/live/                live trace intelligence API
app/api/harnesses/           harness discovery and leaderboard APIs
components/                  dashboard, run detail, live view, tables, controls
lib/adapters/                harness registry, built-ins, generic descriptor loader
lib/runner/                  headless and tmux runner implementations
lib/grader/                  grader registry and LLM judge path
lib/cli/                     CLI entrypoints for runs, selftest, accuracy audit
lib/cases.ts                 case loading and zod validation
lib/db.ts                    SQLite schema, migrations, and query helpers
lib/live.ts                  local trace parsing and live dashboard summaries
lib/redaction.ts             display redaction for local paths/usernames
cases/                       public case definitions and oracle scripts
fixtures/                    tiny repositories and inputs copied into workdirs
harnesses/                   descriptor-driven harness definitions
scripts/                     maintenance and public-readiness helpers
media/openeval-launch/       HyperFrames source for the OpenEval launch video
data/                        ignored local SQLite DB, transcripts, and workdirs
```

## Development

Install dependencies:

```bash
npm install
```

Run the dashboard:

```bash
npm run dev
```

Verify TypeScript:

```bash
npm run typecheck
```

Run focused tests:

```bash
npm run test:live
npm run test:telemetry
```

Run internal selftests:

```bash
npm run selftest
```

Build for production:

```bash
npm run build
npm start
```

## Adding a Case

1. Add a tiny fixture repository under `fixtures/<fixture-name>/` if the case needs files.
2. Add `cases/<category>/<case-id>.case.json`.
3. Include deterministic graders wherever possible.
4. Add known-bad oracle scripts when a case needs accuracy-audit confidence.
5. Run the case locally.
6. Run `npm run audit:accuracy` and strengthen weak proof surfaces before treating the case as reliable.

Example:

```json
{
  "id": "swe-fix-fizzbuzz",
  "category": "agentic-swe",
  "name": "Fix the FizzBuzz bug",
  "tags": ["bugfix", "node"],
  "prompt": "There is a bug in src/fizzbuzz.js: multiples of 15 should print FizzBuzz. Fix it and run npm test.",
  "setup": {
    "type": "fixture",
    "fixture": "fizzbuzz-repo",
    "init_git": true
  },
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

## Adding a Descriptor Harness

Use a descriptor when a CLI emits Claude stream JSON, Codex JSONL, generic JSONL with stable field paths, or line-oriented text.

1. Create `harnesses/<id>.harness.json`.
2. Declare binary names and optional well-known paths.
3. Map output fields such as final text, usage, cost, duration, error state, and tool calls.
4. Run `npm run run:eval -- --list-harnesses`.
5. Start with one simple case and inspect the transcript before running larger suites.

## Operating Notes

- Node 20 or newer is expected.
- The app uses `better-sqlite3`, so native dependency installation must succeed for the local platform.
- `rubric_llm` uses a separate judge harness; it should not silently reuse the harness under test.
- Missing usage data is shown as missing, not as a real zero.
- Local path redaction is for display; raw local paths may still exist server-side in local-only transcripts.
- Public repository cleanup should be validated with `bash scripts/public-upload-audit.sh` before pushing.
