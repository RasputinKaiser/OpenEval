# Harness Authoring

OpenEval harnesses are descriptors. Bundled harnesses and user harnesses use the same JSON schema from `lib/adapters/schema.ts`; bundled descriptors live in `lib/adapters/builtin.ts`, and user descriptors live in `harnesses/*.harness.json`.

User descriptors override bundled descriptors by `id`. The default harness is `OPENEVAL_DEFAULT_HARNESS` when that id is registered; otherwise it is the first registered descriptor.

## Five Minutes

1. Create `harnesses/<id>.harness.json`.
2. Fill in binary discovery, parser, command, prompt, and field mappings.
3. Run:

```bash
npm run selftest
```

4. Open `/harnesses` and check descriptor issues, binary availability, version output, capabilities, and sample command.
5. Run one case:

```bash
npm run run:case -- swe-fix-fizzbuzz --harness <id>
```

## Descriptor Fields

| Field | Type / default | Purpose |
| --- | --- | --- |
| `id` | string, required | Stable id. Must match `/^[a-z0-9][a-z0-9._-]*$/i`. User descriptors with the same id replace bundled descriptors. |
| `label` | string, required | Human-readable name in the UI and CLI. |
| `binNames` | string[], required | Candidate binary names. Discovery checks these on `PATH`. |
| `defaultBin` | string, default `binNames[0]` | Binary used to build commands. |
| `binEnvVar` | string, optional | Environment variable that overrides the binary path at command-build time. |
| `wellKnownPaths` | string[], optional | Extra executable paths for discovery. `~` is expanded in discovery. |
| `versionArgs` | string[], default `["--version"]` | Arguments used for the version probe. |
| `parser` | `claude-stream-json`, `codex-jsonl`, `generic-jsonl`, or `text`; required unless `output` is set | Selects stdout line parser. |
| `output` | legacy `stream-json`, `jsonl`, `json`, or `text`; optional | Back-compat mapping: `stream-json` to `claude-stream-json`; `jsonl` and `json` to `generic-jsonl`; `text` to `text`. |
| `argTemplate` | string[], required | Initial command arguments. Tokens may contain substitutions. |
| `prompt` | object, default inferred | How the prompt is passed: `arg`, `flag`, `stdin`, or `template`. `flag` requires `prompt.flag`. |
| `promptPlaceholder` | string, legacy optional | Alias for `prompt: { "mode": "flag", "flag": value }`. |
| `workdirFlag` | string, optional | Appended with the workdir unless `{workdir}` already appears in `argTemplate`. |
| `modelFlag` | string, optional | Appended with the selected model only when a model is set and `{model}` is not already in `argTemplate`. |
| `maxTurnsFlag` | string, optional | Appended with max turns only when `maxTurns > 0` and `{maxTurns}` is not already in `argTemplate`. |
| `permissionFlag` | string, optional | Simple permission form: appends `<permissionFlag> <permissionMode>`. |
| `permissionArgs` | object of string[] by permission mode, optional | Full permission form. Uses the selected mode key, then `"*"` as fallback. Values support substitutions. |
| `appendExtraArgs` | boolean, default `true` | Whether `runner.extra_args` from a case is appended. |
| `extraEnv` | object of string values, default `{}` | Environment variables added to the harness process. |
| `eventFilter` | string dot path, optional | For `generic-jsonl`, reads an event type path used when deciding whether a line is a result-like summary. It does not drop nonmatching lines. |
| `fields` | object, default `{}` | Dot-path mapping into generic JSONL events and `jsonl-dir` live traces. Required when `parser` is `generic-jsonl`. |
| `capabilities` | object, optional | Overrides reported capabilities. |
| `liveTrace` | object, optional | Declares live trace roots and parser format for `/live`. |
| `models` | object, optional | Declares model aliases, a default model, and optional model discovery from a local JSON config. |

`argTemplate`, `permissionArgs`, and command flags support these substitutions:

| Token | Value |
| --- | --- |
| `{prompt}` | Case prompt. |
| `{workdir}` | Prepared case workdir. |
| `{model}` | Selected model, or empty string. |
| `{maxTurns}` | Runner max turns. |
| `{permissionMode}` | Runner permission mode. |

## Prompt Modes

| Mode | Behavior |
| --- | --- |
| `arg` | Appends the prompt as the trailing argument. |
| `flag` | Appends `<prompt.flag> <prompt>`. |
| `stdin` | Writes the prompt to process stdin. |
| `template` | Does not append the prompt; use `{prompt}` in `argTemplate`. |

If `prompt` is absent, normalization chooses `template` when `{prompt}` appears in `argTemplate`, then legacy `promptPlaceholder`, otherwise `arg`.

## Field Mappings

Field paths use dots and numeric indexes. `items[0].text` is normalized to `items.0.text`.

Mappable fields from `FieldMappingSchema`:

| Field | Purpose |
| --- | --- |
| `finalText` | Assistant text to store as final output and transcript message. |
| `sessionId` | Session id. |
| `model` | Model id/name. |
| `toolCallName` | Tool/function name. |
| `toolCallId` | Tool call id. |
| `toolCallInput` | Tool input. String inputs are parsed as JSON when possible. |
| `toolCallOutput` | Tool result output. |
| `toolCallError` | Truthy tool result error marker. |
| `durationMs` | Duration in milliseconds. |
| `numTurns` | Turn count. |
| `costUsd` | Cost in USD. |
| `inputTokens` | Input token count. |
| `outputTokens` | Output token count. |
| `cacheReadTokens` | Cache-read token count. |
| `cacheCreateTokens` | Cache-create token count. |
| `stopReason` | Stop reason. |
| `isError` | Truthy run error marker. |

For `generic-jsonl`, a line with `toolCallName` emits a `tool_use` event and a line with `toolCallOutput` emits a `tool_result` event. A line with duration, token, error, or result-like event type updates the accumulated runner result.

## Capabilities

`capabilities` can override:

- `reportsCost`
- `reportsTokens`
- `reportsTurns`
- `supportsVisionInput`
- `permissionModes`

Without overrides, structured parsers (`claude-stream-json`, `codex-jsonl`) report cost/tokens/turns; generic descriptors report those capabilities when the corresponding mapped fields exist. `supportsVisionInput` defaults to `unknown` (`null`) because an omitted flag is not evidence that a harness cannot accept images. `permissionModes` defaults to all permission modes from the schema; descriptors should override it with an explicit list when the CLI exposes a narrower surface.

## Live Trace

`liveTrace` fields:

| Field | Type / default | Purpose |
| --- | --- | --- |
| `format` | `claude-projects`, `codex-sessions`, or `jsonl-dir`; default `jsonl-dir` | Parser and directory layout for `/live`. |
| `roots` | string[], required | Roots to scan. `~` expands to the home directory. |
| `maxDepth` | positive integer, optional | Recursive depth for `jsonl-dir` and `codex-sessions`; default is `5` for Codex, `2` for Claude-projects, `4` for generic JSONL. |
| `fields` | `FieldMapping`, optional | Generic field mappings for live metrics. For `jsonl-dir`, adapter fields are used when omitted. |
| `inferredModel` | string, optional | Model reported as inferred when a trace has no model. |

Formats:

- `claude-projects`: scans project subdirectories one level below each root for `.jsonl` files.
- `codex-sessions`: recursively scans `.jsonl` files and parses Codex session records.
- `jsonl-dir`: recursively scans `.jsonl` files and applies generic field mappings plus Claude-style trace handling.

## Models

`models` fields:

| Field | Type | Purpose |
| --- | --- | --- |
| `aliases` | `{ id, label, family }[]` | Static model choices. They are marked as alias-sourced in the model picker. |
| `default` | string | Default model used when a run does not specify one. |
| `discovery.file` | string | Local JSON file to read; `~` expands. |
| `discovery.jsonPath` | string | Dotted path to objects whose keys are model ids. `*` wildcard segments iterate every key at that level. |

The model API returns descriptor aliases, discovered config models, and the descriptor default if it was not already found.

## Command Assembly

`buildDescriptorCommand` assembles commands in this order:

1. Start with `argTemplate` after substitutions.
2. Append `permissionArgs[permissionMode]`, or `permissionArgs["*"]`, or `<permissionFlag> <permissionMode>`.
3. Append `workdirFlag`, `modelFlag`, and `maxTurnsFlag` when present and not already represented by placeholders in `argTemplate`; `modelFlag` requires a selected model, and `maxTurnsFlag` requires `maxTurns > 0`.
4. Append case `extra_args` unless `appendExtraArgs` is `false`.
5. Add the prompt by mode: trailing arg, flag pair, stdin, or no-op for template mode.

The spawned process runs in the prepared workdir with `process.env` plus `extraEnv`.

## Worked Example

This example is based on `harnesses/hermes.harness.json`, with inline annotations:

```json
{
  "id": "hermes",
  "label": "Hermes CLI",
  "binNames": ["hermes"],
  "wellKnownPaths": ["~/.local/bin/hermes", "~/.hermes/bin/hermes"],
  "versionArgs": ["--version"],
  "output": "jsonl",
  "argTemplate": ["run", "--json", "--workdir", "{workdir}"],
  "prompt": { "mode": "flag", "flag": "--prompt" },
  "extraEnv": {},
  "fields": {
    "finalText": "message.text",
    "sessionId": "session_id",
    "model": "model",
    "toolCallName": "tool.name",
    "toolCallId": "tool.id",
    "toolCallInput": "tool.input",
    "toolCallOutput": "result.output",
    "toolCallError": "result.is_error",
    "durationMs": "duration_ms",
    "numTurns": "num_turns",
    "inputTokens": "usage.input_tokens",
    "outputTokens": "usage.output_tokens",
    "costUsd": "usage.cost_usd",
    "stopReason": "stop_reason",
    "isError": "is_error"
  }
}
```

Notes:

- `output: "jsonl"` is the legacy spelling for `parser: "generic-jsonl"`.
- `{workdir}` is already in `argTemplate`, so no `workdirFlag` is needed.
- The prompt is sent as `--prompt <case prompt>`.
- Because the parser is generic JSONL, `fields` is required.

With a case workdir of `/tmp/workdir`, prompt `Fix the bug`, and permission mode `bypassPermissions`, the sample command shape is:

```bash
hermes run --json --workdir /tmp/workdir --prompt "Fix the bug"
```

## Bundled Descriptors

Bundled Claude Code, Codex, and ncode descriptors use the same schema. For example, the Codex descriptor in `lib/adapters/builtin.ts` contains:

```json
{
  "id": "codex",
  "label": "Codex CLI",
  "binNames": ["codex"],
  "binEnvVar": "CODEX_BIN",
  "wellKnownPaths": ["~/.local/bin/codex", "~/.codex/bin/codex"],
  "parser": "codex-jsonl",
  "argTemplate": ["exec", "--json", "--skip-git-repo-check"],
  "permissionArgs": {
    "bypassPermissions": ["--dangerously-bypass-approvals-and-sandbox"],
    "default": ["-s", "read-only"],
    "*": ["-s", "workspace-write"]
  },
  "modelFlag": "-m",
  "prompt": { "mode": "arg" },
  "capabilities": {
    "reportsCost": false,
    "supportsVisionInput": true,
    "permissionModes": ["bypassPermissions", "default"]
  },
  "liveTrace": {
    "format": "codex-sessions",
    "roots": ["~/.codex/sessions", "~/.codex/archived_sessions"],
    "maxDepth": 5
  }
}
```

No bundled descriptor has a command-building path that user descriptors cannot use.

## Validation Surfaces

Invalid descriptors are loaded as issues, not silently hidden. Issues surface through:

- `GET /api/harnesses` as `descriptorIssues`
- `/harnesses`
- `npm run selftest` under the harness descriptor checks
