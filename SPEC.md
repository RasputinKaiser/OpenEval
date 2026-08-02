# OpenEval — Spec

## Vision

OpenEval is a local-first evidence cockpit for understanding how AI agents behave over time. It should collect as much useful signal as possible from thousands of past sessions without turning the machine into an opaque storage dump, preserve raw transcripts as the authority, and present derived summaries, evaluations, charts, and harness health with enough provenance that experts can audit every conclusion while newcomers can still understand what matters in one glance. This next product pass improves accuracy, stability, information architecture, responsiveness, and the connection between harnesses, judges, observation history, and evaluation results.

## Audience & Jobs to Be Done

- **Target audience:** Solo developers and AI/evaluation engineers operating local agent CLIs, with the same evidence model progressively disclosed for first-time or non-technical operators.
- **Primary job:** When I'm trying to understand, compare, or improve an AI agent's behavior across real sessions and repeatable evaluations, I want to move from trustworthy raw evidence to a clear explanation quickly, so I can make a better harness, model, prompt, or workflow decision without losing the underlying detail.
- **Activity map:** connect harnesses → discover and preserve sessions → parse and normalize evidence → triage signal → inspect transcript/tool/reasoning detail → compare evaluations and time windows → understand uncertainty → act and re-check

## Design Direction

- **Vibe:** Calm evidence room: trustworthy, compact, technically deep on demand, and plain-language at the point of decision.
- **References:** The existing OpenEval product, its current mature evaluation dashboard, Live/Collection/Timeline surfaces, and the user's “deeply detailed for experts, simple for newcomers” direction. No `goal-design/` reference images were present in this checkout. Public project/support links: [Ko-fi](https://ko-fi.com/rasputinkaiser), [X/contact](https://x.com/RasputinKaiser), [other projects](https://ras.artificiallexicon.com/), and [Learning AI](https://www.artificiallexicon.com/).
- **Theme:** Preserve the existing dark/light-capable system, strong semantic status colors, compact data-dense layouts, and readable typography while improving hierarchy and responsive behavior.
- **Fidelity:** High fidelity to the existing OpenEval design system; this is an integration and evidence-flow pass, not a visual rewrite.

## Features

- **Parser Health Heatmap** — show a 30-day per-harness grid of parse success, dropped records, and truncation rates so operators can catch degrading adapters before evidence gaps accumulate. MVP: a bounded 30-day per-harness heatmap with success/drop/truncation counts and rates, denominators, partial-scan indicators, accessible day details, and clear no-data states.
  - [ ] For every harness/day cell with data, the heatmap exposes parse success, drop, and truncation rates with the underlying denominator and flags partial scans, while allowing the operator to identify the affected source/day without implying that missing data was successfully parsed.
- **Parse Error Drill-Down** — let operators click any Parser Health Heatmap cell to inspect the exact dropped or truncated records behind the signal, with a bounded raw excerpt and parser-version provenance to close the loop between health telemetry and root cause. MVP: open a cell detail panel listing affected records, error/truncation reason, source identity, timestamp, parser version, and a safe raw excerpt with explicit redaction and truncation boundaries.
  - [ ] Selecting a heatmap cell reveals only records belonging to that harness/day and reported health category, includes the exact parser version and reason for each record, and makes the raw excerpt inspectable without implying that the bounded excerpt is the complete source transcript.
- **Session Diff View** — show a side-by-side synchronized turn-level diff between two sessions from the same harness, surfacing behavioral regressions, changed tool usage, reasoning shifts, and divergent outcomes without hiding the raw evidence. MVP: select two compatible sessions, align turns by stable sequence/role/tool identity where possible, highlight additions/removals/changes, mark alignment gaps explicitly, and link each diff back to the raw transcript evidence.
  - [ ] Given two sessions from the same harness, the view shows a synchronized side-by-side diff with turn-level change labels and direct links or actions to inspect the original transcript evidence, while explicitly marking unmatched or heuristically aligned turns instead of presenting alignment as certain.
- **Pre-Launch Judge Cost Preview** — before a judge job starts, show an estimated token count and approximate cost for each available backend—Codex, Claude, and OpenRouter—derived from the selected transcript length so operators can choose knowingly without surprise spending. MVP: present per-backend input/output token estimates, pricing assumptions, approximate total cost, unavailable/ subscription-backed states, and a visible estimate disclaimer before confirmation.
  - [ ] Before execution, the operator can compare every available backend's estimated tokens and approximate cost, and the estimate records its transcript basis, pricing/source assumptions, and uncertainty without being presented as an invoice or guaranteed final charge.
- **Command Palette (⌘K)** — provide a keyboard-first palette from any primary route for jumping directly to sessions, runs, harnesses, and cases by ID or name, giving expert operators a fast navigation path without requiring full global-search infrastructure. MVP: open from any primary route with ⌘K or Ctrl+K, search a bounded route-aware metadata set, group results by entity type, show useful context, and navigate with keyboard selection.
  - [ ] From any primary page, ⌘K/Ctrl+K opens an accessible palette; typing an exact or partial ID/name returns correctly categorized session, run, harness, or case results, and Enter navigates to the selected destination without requiring a full transcript/content index.
- **Harness Pulse Indicator** — show an ambient per-harness health badge on the dashboard with the last probe result and the elapsed time since that harness last produced a successful parse. MVP: compact status badges for connected, degraded, unavailable, and stale states with last-probe time, last-successful-parse time, and an accessible detail/recovery path.
  - [ ] For every discovered harness, the dashboard displays a clearly labeled current probe status and time since the last successful parse, distinguishes unavailable data from failure, and links to the harness detail or recovery action without implying freshness when no successful parse exists.

- **Durable observation ingestion and parsing** — preserve raw transcript authority while extracting bounded, source-aware conversational, reasoning, tool, usage, error, and lineage evidence from every configured harness. MVP: raw stdout/stderr authority for OpenEval-launched runs, shared descriptor semantic normalization, trusted source-qualified transcript resolution, bounded parser/cache cardinality, and revision-bound transcript continuation.
  - [ ] Implement the contracts in `specs/observation-ingestion.md` and `specs/transcript-evidence.md` without duplicating the current reasoning work.
- **Evidence cockpit for Live, Collection, Timeline, and evals** — make summary-first paths fast for newcomers while keeping expandable raw detail, provenance, uncertainty, and expert controls available. MVP: one source-qualified session brief, exact raw/derived/partial states, linked evaluation attempts, and one complete observation-to-re-check handoff.
  - [ ] Implement `specs/transcript-evidence.md` and `specs/evidence-handoff.md` on top of the existing mature cockpit.
- **Universal harness connection center** — let operators connect any compatible CLI harness through a descriptor-driven contract, then inspect, reconnect, disconnect, probe, and verify observation/judge readiness with concrete recovery states. Bundled Codex, Claude, and ncode adapters are reference implementations, not a closed provider list. MVP: validated descriptor JSON import/edit, safe registration lifecycle, separate readiness layers, structured recovery, and persistence across restart.
  - [ ] Implement `specs/harness-connection-and-onboarding.md`.
- **Dashboard, information architecture, and responsive visualizations** — organize existing pages around clear tasks, improve charts/tabs/panels/dropdowns, and keep dense visual evidence fast on desktop and mobile. MVP: preserve the existing Evaluate/Observe/System IA and complete cross-route integration, responsive states, and measured performance proof.
  - [ ] Validate the existing cockpit and new flow per `specs/product-shell-and-validation.md`.
- **Onboarding flow** — guide a new operator from first launch to a useful connected harness and first evidence view without hiding the expert path. MVP: one resumable measured state machine for connect/verify, discover-or-run-once, and open-first-evidence, retaining dismiss/replay and expert direct navigation.
  - [ ] Implement the onboarding contract in `specs/harness-connection-and-onboarding.md`.
- **Support, contact, and donation touchpoints** — keep OpenEval freely usable and make it easy for people who value the project to support it or find related work. MVP: Ko-fi support link plus clear links to X/contact, other projects, and Learning AI; no account requirement, entitlement system, billing SDK, or payment data stored by OpenEval.
  - [ ] Add the canonical links and free/local-first framing per `specs/product-shell-and-validation.md`.

## Phases

- **Phase 1 — MVP:** Ship the smallest coherent path from onboarding through managed any-harness connection, trustworthy raw/derived observation ingestion, source-qualified session understanding, and manual per-job Codex/Claude judge choice, with optional configured OpenRouter and lightweight support/contact links.
- **Phase 2 — Features:** Complete one evidence-to-evaluation-to-re-check handoff, source-qualified run/session linkage, semantic parity for generic harnesses, persistent cache freshness, scale-safe evaluation-history access, and bounded artifact delivery without expanding into a general workflow system.
- **Phase 3 — Polish:** Prove responsive density, loading performance, accessibility, recovery states, storage accounting, and public documentation without weakening evidence provenance.

## End Result

A public-quality, free OpenEval experience where a new operator can verify a harness and reach the first trustworthy evidence view through one measured path, while an expert can inspect exact available raw output, normalized conversation/reasoning/tools/artifacts, judge receipts, parsing warnings, and population denominators, then launch and revisit one linked re-check. Optional support and contact paths are visible, but product access is never paywalled.

## Release Scope

Release: First Evidence Loop; free/local-first, with optional Ko-fi support

Activities: connect or verify → collect or run once → preserve → understand → inspect → choose judge → evaluate/re-check. Future release exclusions are defined in `specs/release-scope.md`.
