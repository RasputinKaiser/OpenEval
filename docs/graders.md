# Graders

Graders are implemented in `lib/grader/index.ts` and typed by `GraderSpecVariant` in `lib/types.ts`. Each grader returns a pass/fail score of `1` or `0`, plus evidence metadata from `lib/accuracy.ts`.

## Scoring

Each grader has `weight`, defaulting to `1`. `evaluate()` computes:

```text
passRatio = sum(weights for passed graders) / sum(all weights)
passed = no forbidden violations && passRatio >= pass_threshold
```

`pass_threshold` defaults to `1`. In current source, a forbidden violation is any grader with `forbidden: true` whose result failed. For forbidden checks, write the grader so it passes when the forbidden condition is absent, usually with `negate` where the grader supports it.

## `exit_code`

Parameters: `command`, optional `cwd`, `env`, `timeout_ms`, `weight`.

Runs `bash -lc <command>` from the workdir or `cwd` under it. Passing proves the command exited with status `0`. Evidence tier: `deterministic`.

```json
{ "type": "exit_code", "command": "node scripts/verify.js", "timeout_ms": 30000 }
```

## `tests_pass`

Parameters: `command`, optional `cwd`, `env`, `timeout_ms`, `weight`.

Runs a test command. Passing requires exit status `0` and no parsed failed count in output. It also extracts simple passed/failed counts for detail text. Evidence tier: `deterministic`.

```json
{ "type": "tests_pass", "command": "npm test", "timeout_ms": 30000 }
```

## `file_contains`

Parameters: `path`, `pattern`, optional `negate`, `weight`.

Reads a file and applies `new RegExp(pattern, "m")`. Passing proves the pattern is present, or absent when `negate` is true. Evidence tier: `deterministic`.

```json
{ "type": "file_contains", "path": "src/fizzbuzz.js", "pattern": "FizzBuzz" }
```

## `file_exists`

Parameters: `path`, optional `negate`, `weight`.

Checks file access. Passing proves the path exists, or does not exist when `negate` is true. Evidence tier: `deterministic`.

```json
{ "type": "file_exists", "path": "README.md" }
```

## `file_eq`

Parameters: `path`, `expected`, optional `trim`, `weight`.

Reads a file and compares it to `expected`. When `trim` is true, both sides are trimmed before comparison. Evidence tier: `deterministic`.

```json
{ "type": "file_eq", "path": "answer.txt", "expected": "42\n", "trim": true }
```

## `regex_match`

Parameters: `pattern`, optional `source`, `negate`, `weight`. `source` is `stdout`, `final_text`, or `transcript`; default is `final_text`.

Applies `new RegExp(pattern, "m")` to the selected source. `stdout` uses `runner.resultText + runner.finalText`; `transcript` uses a synthesized transcript string. Evidence tier: `deterministic`.

```json
{ "type": "regex_match", "source": "final_text", "pattern": "answer\\s*:\\s*42" }
```

## `json_path`

Parameters: `path`, `jsonpath`, `equals`, optional `weight`.

Reads and parses a JSON file, then walks a dotted path. Passing proves the JSON value equals `equals` after `JSON.stringify` comparison. The implementation supports simple dot segments, not wildcard JSONPath. Evidence tier: `deterministic`.

```json
{ "type": "json_path", "path": "package.json", "jsonpath": "type", "equals": "module" }
```

## `files_unchanged`

Parameters: `paths`, optional `fixture`, `weight`.

Compares selected workdir files against the fixture source using SHA-256 content hashes. Passing proves all listed files still match the fixture baseline. The optional `fixture` field is accepted, but current code uses the executor-provided fixture source path. Evidence tier: `deterministic`.

```json
{ "type": "files_unchanged", "paths": ["src/fizzbuzz.test.js"] }
```

## `file_deleted`

Parameters: `path`, optional `weight`.

Passes when reading the file fails. Passing proves the path is absent. Evidence tier: `deterministic`.

```json
{ "type": "file_deleted", "path": "obsolete.txt" }
```

## `git_diff_contains`

Parameters: `pattern`, optional `negate`, `pathFilter`, `weight`.

Runs `git diff --no-color`, optionally restricted by `pathFilter`, and matches the diff with `new RegExp(pattern, "m")`. Passing proves the final diff contains or does not contain a pattern. Evidence tier: `deterministic`.

```json
{ "type": "git_diff_contains", "pathFilter": "src/fizzbuzz.js", "pattern": "FizzBuzz" }
```

## `checksum`

Parameters: `path`, `expected`, optional `algorithm`, `weight`. `algorithm` defaults to `sha256` and may be `sha256` or `md5`.

Hashes file text and compares the digest. Passing proves exact content identity for the chosen hash. Evidence tier: `deterministic`.

```json
{ "type": "checksum", "path": "dist/artifact.svg", "algorithm": "sha256", "expected": "..." }
```

## `step`

Parameters: optional `tool`, `input_includes`, `input_includes_any`, `at_index`, `min_count`, `before_tool`, `negate`, `weight`.

Inspects parsed runner tool calls. Passing proves a tool-call shape, count, position, order, or absence. Evidence tier: `trace`.

```json
{ "type": "step", "tool": "shell", "input_includes_any": ["npm test", "node --test"], "min_count": 1 }
```

## `rubric_llm`

Parameters: `rubric`, optional `min_score`, `model`, `judge_harness`, `judge_model`, `weight`.

Calls a separate judge harness with the final output and transcript excerpt, expects JSON containing `passed`, `score`, and `reason`, and passes when `passed` is true or `score >= min_score`. Default `min_score` is `0.7`. `GraderSpecVariant` includes `judge_harness` and `judge_model`, and `runGrader()` reads them before falling back to `JUDGE_HARNESS`, `claude-code`, `JUDGE_MODEL`, or `model`; the zod case schema currently does not list those two override fields. Evidence tier: `llm_judge`.

```json
{
  "type": "rubric_llm",
  "judge_harness": "claude-code",
  "min_score": 0.8,
  "rubric": "Pass only if the answer identifies the bug and explains the fix."
}
```

## `manual`

Parameters: optional `note`, `weight`.

Always returns failed with a pending manual-review detail. Passing proves nothing automatically; it marks the case for human review. Evidence tier: `manual`.

```json
{ "type": "manual", "note": "Inspect visual polish before accepting." }
```

## Evidence Tiers

`lib/accuracy.ts` classifies grader types this way:

| Tier | Graders |
| --- | --- |
| `deterministic` | `exit_code`, `tests_pass`, `file_contains`, `file_exists`, `file_eq`, `regex_match`, `json_path`, `files_unchanged`, `file_deleted`, `git_diff_contains`, `checksum` |
| `trace` | `step` |
| `llm_judge` | `rubric_llm` |
| `manual` | `manual` |

The `visual` tier is not assigned by a grader type. The accuracy audit increments it when a case declares `visual.expected_artifacts`.
