# Redaction

OpenEval redaction is a layered pipeline. The deterministic layers stay on by default; the machine-learning PII layer is additive and off by default.

## Layers

1. Deterministic path redaction masks local user path segments such as `/Users/<name>/...`, `/home/<name>/...`, and dashed live-trace path forms like `-Users-name-`.
2. Deterministic secret redaction masks credential-shaped strings such as OpenAI keys, OpenRouter keys, GitHub tokens, AWS access keys, Slack tokens, Google API keys, npm tokens, Hugging Face tokens, JWTs, private key blocks, and bearer tokens.
3. Optional Rampart PII redaction detects person, location, organization, and other PII-like entities. It is additive, off by default, and never replaces the deterministic path or secret layers.

## Rampart PII Layer

The optional PII backend uses model `nationaldesignstudio/rampart`, ONNX runtime, ~14.7 MB, MiniLM-L6-H384 architecture, ~18.5M params, 4-bit quantized, 35-label BIO scheme covering 17 entity types, supports seven Latin-script languages, ~98.4% private-term recall on its benchmark.

Known weaknesses: ~14% recall on non-Latin scripts, ~67.6% on checksum-less government ID numbers, and it is vulnerable to zero-width-character injection attacks. This is why the deterministic layers for paths and secrets always stay on regardless of whether the PII layer is enabled, and the PII layer is purely additive and optional.

To enable it:

```sh
npm install @huggingface/transformers
```

The package is already listed in `optionalDependencies`. The first call to `redactPii()` or `rampartAvailable()` downloads the model to the local Hugging Face cache. Inference runs fully locally via onnxruntime, with no network calls after the initial download.

## API

Use `redactText()` for the default production pipeline:

```ts
import { redactText } from "../lib/redaction";

const text = await redactText("token sk-abcdefghijklmnopqrstuvwxyz at /Users/ralto/project");
// => "token [REDACTED:openai-key] at /Users/[redacted]/project"
```

Options default to `{ paths: true, secrets: true, pii: false }`. Layers run in this order: `pii`, then `secrets`, then `paths`.

```ts
const text = await redactText(input, {
  paths: true,
  secrets: true,
  pii: true,
});
```

Use `redactTextWithReport()` when the caller needs layer-by-layer status:

```ts
import { redactTextWithReport } from "../lib/redaction";

const result = await redactTextWithReport(input, { pii: true });
// {
//   text: "...",
//   layers: [
//     { layer: "pii", applied: true, changed: true },
//     { layer: "secrets", applied: true, changed: false },
//     { layer: "paths", applied: true, changed: true },
//   ],
// }
```

For the `pii` layer, `applied` is true only when the option is enabled and Rampart is importable. If Rampart is missing or fails, PII redaction returns the original text unchanged.

## OpenEval Usage

Redaction is used in:

- live view username masking in `lib/live.ts`
- the `report --redact` CLI flag: `report.md` and every JSON file in the bundle (`manifest.json`, `summary.json`, per-case `runner-result.json`, `grader-result.json`, `transcript.json`) have all string fields run through the secrets + paths pipeline
- data exports
