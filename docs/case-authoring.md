# Case Authoring

Cases are `.case.json` files under `cases/<category>/`. They are validated by `CaseDefinitionSchema` in `lib/cases.ts`, whose TypeScript shape is `CaseDefinition` in `lib/types.ts`.

## Fields

| Field | Type / default | Purpose |
| --- | --- | --- |
| `id` | string, required | Stable case id. |
| `category` | `agentic-swe`, `single-tool`, `reasoning`, or `visual-code`; required | Case group and route filter. |
| `difficulty` | `easy`, `medium`, or `hard`; optional | Difficulty filter and display metadata. |
| `name` | string, required | Human-readable case name. |
| `description` | string, optional | Longer explanation for the case browser. |
| `tags` | string[], optional | Tag filters. |
| `split` | `public` or `held_out`; optional | Dataset split metadata. |
| `canary` | string, optional | Canary metadata. |
| `prompt` | string, required | Exact instruction sent to the harness. |
| `setup` | object, optional | How to prepare the workdir. |
| `runner` | object, optional | Per-case runner settings. |
| `budget` | object, optional | Cost and turn ceilings checked after the run. |
| `oracle` | object, optional | Selftest oracle and baseline controls. |
| `visual` | object, optional | Visual task contract. |
| `graders` | grader[], required, min 1 | Checks used to score the result. |
| `pass_threshold` | number, default `1` | Weighted ratio required to pass. |

## Setup

| Field | Type | Purpose |
| --- | --- | --- |
| `type` | `none`, `fixture`, or `git-clone` | Workdir source. |
| `fixture` | string | Directory under `fixtures/` copied into the run workdir when `type` is `fixture`. |
| `repo` | string | Git repository URL/path required when `type` is `git-clone`. |
| `workdir_name` | string | Present in the type but not used by `prepareWorkdir` today. |
| `init_git` | boolean | Initializes a baseline git repository in the prepared workdir. |

`prepareWorkdir` creates `data/workdirs/<runId>/<caseId>__s<sample>`. Fixture setup copies from `fixtures/<fixture>` and skips `node_modules` and `.git`. When `init_git` is true, OpenEval runs `git init`, stages all files, and creates a local baseline commit.

## Runner

| Field | Type / default in executor | Purpose |
| --- | --- | --- |
| `max_turns` | number, default `25` | Passed to the harness context. |
| `timeout_seconds` | number, default `300` | Process timeout in seconds. |
| `permission_mode` | permission mode, default `bypassPermissions` | Passed to descriptor permission assembly. |
| `model` | string, optional | Model for this case unless overridden at run creation. |
| `extra_args` | string[], default `[]` | Extra command arguments appended unless the descriptor disables them. |

## Budget

| Field | Type | Purpose |
| --- | --- | --- |
| `max_cost_usd` | number | Fails the case if reported cost exceeds this value. |
| `max_turns` | number | Fails the case if reported turns exceed this value. |

Budget checks run after the runner result is available. If exceeded, `budget_exceeded` is set and final status is `failed`.

## Oracle

| Field | Type | Purpose |
| --- | --- | --- |
| `solve` | string | Shell script path relative to the case category directory. `selftest` runs it inside a prepared workdir. |
| `final_text` | string | Synthetic final answer used by `selftest` when no solve script is needed. |
| `noop_max_score` | number, default `0` | Maximum allowed pass ratio for an unchanged/no-op baseline in `selftest`. |
| `known_bad` | string[] | Metadata consumed by the accuracy audit as known-bad coverage. |

Oracles matter because `npm run selftest` first grades a no-op baseline and fails if it scores above `noop_max_score`. When an oracle exists, selftest applies the oracle solve script or final text and checks that the graders pass. This catches graders that are too weak, impossible, or miswired.

## Visual

| Field | Type | Purpose |
| --- | --- | --- |
| `kind` | `svg`, `threejs`, `web_ui`, `app_ui`, or `screenshot` | Visual artifact class. |
| `requires_vision_input` | boolean | Marks cases that require visual input. |
| `expected_artifacts` | string[] | Artifact names/contracts. The accuracy audit counts these as visual evidence. |

## Graders

`graders` is an array of grader specs from `GraderSpecVariant`. Each grader may include:

- `weight`: defaults to `1`.
- `forbidden`: optional hard-fail flag. In current evaluator logic, a forbidden violation is a forbidden grader whose result failed, so write the grader to pass when the forbidden condition is absent.

`pass_threshold` is compared with the weighted pass ratio:

```text
passed_weight / total_weight >= pass_threshold
```

The case also fails if any forbidden grader fails.

## Worked Example

This is `cases/agentic-swe/swe-fix-fizzbuzz.case.json`, annotated field by field:

```json
{
  "id": "swe-fix-fizzbuzz",
  "difficulty": "easy",
  "category": "agentic-swe",
  "name": "Fix the FizzBuzz bug",
  "description": "The fizzbuzz function is returning wrong output for multiples of 15 (and any number divisible by both 3 and 5). Diagnose and fix so that multiples of 3 produce 'Fizz', multiples of 5 produce 'Buzz', and multiples of both produce 'FizzBuzz'. Run the tests to confirm.",
  "tags": ["bugfix", "node", "tests"],
  "prompt": "There is a bug in src/fizzbuzz.js: multiples of 15 (like 15 and 30) should print 'FizzBuzz' but currently print 'Fizz'. Investigate the code, fix the bug, and run the tests with `npm test` to make sure they all pass. Do not change the test file.",
  "setup": {
    "type": "fixture",
    "fixture": "fizzbuzz-repo"
  },
  "runner": {
    "max_turns": 18,
    "timeout_seconds": 240,
    "permission_mode": "bypassPermissions"
  },
  "graders": [
    {
      "type": "tests_pass",
      "command": "npm test",
      "timeout_ms": 30000
    },
    {
      "type": "file_contains",
      "path": "src/fizzbuzz.js",
      "pattern": "FizzBuzz"
    },
    {
      "type": "exit_code",
      "command": "node -e \"const {fizzbuzz}=require('./src/fizzbuzz'); const p=fizzbuzz(30).split(','); if(p[14]!=='FizzBuzz'||p[29]!=='FizzBuzz') process.exit(1)\""
    }
  ],
  "pass_threshold": 1,
  "oracle": {
    "solve": "oracle/swe-fix-fizzbuzz.sh"
  }
}
```

Annotations:

- `setup.fixture` pairs the case with `fixtures/fizzbuzz-repo`, which contains `package.json`, `src/fizzbuzz.js`, and `src/fizzbuzz.test.js`.
- No `init_git` is set, so graders do not depend on a baseline commit.
- The runner has a shorter turn and timeout budget than the executor defaults.
- The three graders require passing tests, source text containing `FizzBuzz`, and a direct runtime assertion for indices 15 and 30.
- `pass_threshold: 1` means all weighted graders must pass.
- `oracle.solve` points to `cases/agentic-swe/oracle/swe-fix-fizzbuzz.sh`, which selftest runs from the prepared workdir.

## Fixtures Pairing

Use fixtures when a case needs files. A fixture name is a directory under `fixtures/`, and the case prompt should refer to paths inside that copied tree. Graders also resolve relative file paths and command working directories from the prepared workdir.

For example, `fixture: "fizzbuzz-repo"` gives the harness a tiny Node project. The case prompt asks it to edit `src/fizzbuzz.js`; the `tests_pass` grader runs `npm test` in the copied workdir; the `file_contains` grader reads the copied `src/fizzbuzz.js`.
