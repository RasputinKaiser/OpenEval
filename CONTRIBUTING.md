# Contributing to OpenEval

Thanks for helping improve OpenEval. This project is a local-first evaluation dashboard for agent CLIs, so the most useful contributions strengthen repeatability, proof quality, trace clarity, and operator ergonomics.

## Development Setup

```bash
npm install
npm run dev
```

Open http://localhost:3000 to use the dashboard.

Before sending a change, run the same checks CI runs:

```bash
npm run typecheck && npm test && npm run lint
bash scripts/public-upload-audit.sh
```

`npm test` runs the full suite (`tests/*.test.ts`), not just the live-trace subset — a change that only passes `test:live` can still be CI-red.

For changes touching cases or graders, also run:

```bash
npm run selftest
npm run audit:accuracy
```

`npm run selftest` grades a no-op baseline for every case, executes each `oracle.known_bad` script, and fails if the graders pass a known-bad answer.

## Contribution Areas

Good first areas:

- Add or strengthen deterministic graders.
- Add small, focused evaluation cases under `cases/`.
- Improve descriptor harness support under `harnesses/`.
- Improve live trace provenance without treating missing values as zero.
- Improve dashboard clarity for runs, cases, harnesses, and accuracy audits.
- Add known-bad oracle coverage for existing cases.

Larger areas:

- New custom harness adapters in `lib/adapters/`.
- New grader types in `lib/grader/index.ts`.
- More robust trace intelligence in `lib/live.ts`.
- Better public-readiness and privacy checks in `scripts/public-upload-audit.sh`.

## Case Quality Expectations

Cases should be tiny, reproducible, and clear. Prefer a deterministic proof surface over an LLM-only judgment whenever possible.

For a new case:

1. Add a fixture under `fixtures/<name>/` only when the case needs files.
2. Add a `.case.json` file under the appropriate `cases/<category>/` folder.
3. Include at least one deterministic grader when possible.
4. Add a known-bad oracle script when it meaningfully improves confidence. `npm run selftest` executes every `known_bad` script and fails if the graders accept its output.
5. Run the case locally and inspect the transcript.
6. Run `npm run selftest` and `npm run audit:accuracy`.

Avoid committing generated run output, local transcripts, workdirs, SQLite files, `.codex/`, `.ncode/`, or `state.yaml`.

## Privacy and Local Data

OpenEval intentionally stores run history and local stats under `data/`, which is ignored by Git. Do not include real local transcripts, private paths, secrets, API keys, personal account data, or model-provider tokens in issues, pull requests, screenshots, or fixtures.

Some fixtures intentionally contain fake secret-like strings so the suite can test whether an agent preserves protected files. Keep those strings fake and documented in the case description.

Run this before publishing or opening a pull request:

```bash
bash scripts/public-upload-audit.sh
```

## Pull Request Checklist

- The change is scoped to one topic.
- Local-only generated files are not included.
- New cases include enough proof to be useful.
- Missing telemetry remains marked as missing, not zero.
- Public docs use `RasputinKaiser` for GitHub-facing identity when an owner name is needed.
- Verification commands and their results are listed in the pull request.
