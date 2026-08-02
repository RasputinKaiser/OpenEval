# Technology Choices

> These choices were made during API Discovery and inform the implementation plan for the OpenEval universal-harness, observation-quality, judge, and UX pass.

## Selected Technologies

### Universal harness integration: OpenEval descriptor-driven CLI contract

- **Why**: OpenEval already supports descriptor-based harnesses and bundled Codex, Claude, and ncode adapters. The product promise is that any compatible CLI harness can connect through the same contract; bundled adapters are reference implementations, not a closed provider list.
- **SDK**: Existing OpenEval harness descriptor/runtime; no external SDK required.
- **API Key**: Not applicable.
- **Key Features**: custom harness descriptors, binary/version probing, live trace roots, observation parsing, reconnect/disconnect diagnostics, judge-harness separation.
- **Docs**: [Harness Authoring](docs/harness-authoring.md), [Architecture](docs/architecture.md)

### Judge runtime: local Codex/Claude subscription backends

- **Why**: The user wants to use existing Codex and Claude subscriptions, with the current Codex subscription selecting GPT-5.6 Luna. Judge jobs should choose Codex/Luna or Claude manually per job, rather than silently converting the product into a provider-specific API service.
- **SDK**: Existing local CLI harness adapters and `lib/grader/judge.ts`; no new external SDK required.
- **API Key**: Not applicable; subscription authentication stays in the local CLI environments.
- **Key Features**: manual provider/model selection, separate judge harness, GPT-5.6 Luna when Codex is selected, explicit infrastructure-error handling, no required external API billing.
- **Budget policy**: Use GPT-5.6 Luna only when necessary during implementation/evaluation work. The user-provided $5 allowance is a working budget, not a new product paywall or required runtime billing system.
- **Docs**: [Graders](docs/graders.md), [NCODE architecture notes](NCODE.md)

### Optional judge fallback: OpenRouter HTTP backend

- **Why**: OpenRouter is already supported by OpenEval and can provide a fallback or model-experiment path without changing the primary subscription workflow. Its API supports structured JSON Schema output, tool-compatible chat requests, usage metadata, model lists with pricing, routing/fallback models, and account/key spending limits.
- **SDK**: Existing OpenEval HTTP implementation; Context7 also identified the official [`@openrouter/sdk`](https://openrouter.ai/docs/client-sdks/typescript/overview), but adding it is not required for the current code path.
- **API Key**: `OPENROUTER_API_KEY` (optional; skipped for now, not written to `.env.local`).
- **Key Features**: structured outputs, usage/cost accounting, model routing, provider fallback, optional free-model router, key-level spending limits.
- **Docs**: [OpenRouter API overview](https://openrouter.ai/docs/api_reference/overview), [structured outputs](https://openrouter.ai/docs/structured-outputs), [model list and pricing metadata](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)

### Database: local SQLite

- **Why**: Local-first storage is a core product constraint, and the existing application already uses SQLite with `better-sqlite3`, WAL mode, migrations, integrity checks, and bounded caches. Moving history to a hosted database would weaken privacy and add latency without solving the current parsing/UX problem.
- **SDK**: `better-sqlite3` (already installed).
- **API Key**: Not applicable.
- **Key Features**: local durability, fast indexed history, WAL, migrations, read-only health checks, no external database dependency.
- **Docs**: [Architecture](docs/architecture.md), [README storage notes](README.md)

### Transcript and artifact storage: local filesystem

- **Why**: Raw transcripts, archived sessions, evaluation workdirs, and artifacts are already local and should remain authoritative and private. Derived DOM, FTS, API, and chart payloads stay bounded projections of that source.
- **SDK**: Node.js filesystem APIs and existing OpenEval storage helpers.
- **API Key**: Not applicable.
- **Key Features**: raw-source preservation, archive retention, redaction, bounded indexes, symlink-safe artifact access, no storage vendor lock-in.

### Support and contact: outbound links only

- **Why**: OpenEval is free and has no paywall. Support is optional and handled through a normal outbound Ko-fi link; contact and related projects are linked without collecting account or payment data.
- **Ko-fi**: [ko-fi.com/rasputinkaiser](https://ko-fi.com/rasputinkaiser)
- **Contact**: [X / RasputinKaiser](https://x.com/RasputinKaiser)
- **Other projects**: [ras.artificiallexicon.com](https://ras.artificiallexicon.com/)
- **Learning AI**: [artificiallexicon.com](https://www.artificiallexicon.com/)
- **API Key**: Not applicable.

## Researched Alternatives

Context7 research was performed for the three plausible direct/API judge providers:

| Option | Integration / strengths | Billing model and trade-off | Decision |
| --- | --- | --- | --- |
| OpenRouter | OpenAI-compatible HTTP API, structured JSON Schema output, model routing/fallback, usage metadata, and model pricing metadata | Pay-as-you-go/provider-priced; free-model routing exists, but requires an API key and introduces an external billing path | Optional fallback; key skipped for now |
| Direct OpenAI API | Official Responses and Chat Completions APIs, strict JSON Schema, reasoning controls, prompt-cache usage data | Pay-as-you-go token billing; direct control, but no multi-provider routing and requires `OPENAI_API_KEY` | Not selected as the primary path |
| Anthropic API | Official TypeScript SDK, Messages API, structured-output helpers, streaming, batches, and detailed usage fields | Pay-as-you-go token billing; strong Claude path, but requires `ANTHROPIC_API_KEY` and a separate provider integration | Not selected as the primary path |

Research sources: [OpenRouter](https://openrouter.ai/docs/api_reference/overview), [OpenAI developer docs](https://developers.openai.com/api/docs/responses-vs-chat-completions), and [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript).

## Skipped (Not Needed)

- **Hosted database**: not needed; local SQLite is already the intended source of durable run/session history.
- **Hosted authentication**: not needed; there is no account requirement or paywall in the current scope.
- **Payment/subscription API**: not needed; Ko-fi is an outbound donation link only.
- **Email service**: not needed; no transactional or marketing email requirement was identified.
- **Hosted file/media storage**: not needed; transcripts, artifacts, and workdirs remain local-first.
- **Direct OpenAI API**: not needed for the primary judge path because the existing Codex subscription provides GPT-5.6 Luna.
- **Direct Anthropic API**: not needed for the primary judge path because Claude subscription access is handled through the local harness path.

## Environment Variables Summary

| Variable | Service | Status |
|----------|---------|--------|
| `OPENROUTER_API_KEY` | Optional OpenRouter fallback | ⏳ Skipped for now |
| `OPENAI_API_KEY` | Direct OpenAI API | — Not needed |
| `ANTHROPIC_API_KEY` | Direct Anthropic API | — Not needed |
| `STRIPE_SECRET_KEY` | Stripe billing | — Not needed |
| `WORKOS_API_KEY` | Hosted authentication | — Not needed |

No API keys were written during this discovery phase.
