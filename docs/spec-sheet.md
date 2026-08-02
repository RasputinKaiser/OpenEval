# OpenEval — Working Product Spec

Status: Discovery — product direction confirmed, interaction contract open
Source baseline: `main` at `17441012605625acd9c1deebe424d5b6d40f8277`
Last updated: 2026-08-01

> This is a collaborative working sheet, not an implementation contract yet. Decisions marked `TBD` require product input. The repository does not currently contain the referenced `spec-creator.md`, so the exact local process/template still needs to be supplied if it is authoritative.

## 1. Product snapshot

OpenEval is a local-first, harness-agnostic evaluation dashboard for agent CLIs. It lets an operator define repeatable software-task cases, run them through different harnesses, grade the results, retain the run history locally, and inspect the traces and evidence behind each outcome.

The current application already exposes a connected workflow across:

- Dashboard: summary of runs, cases, and recent metrics
- Runs: historical runs, detail, per-case evidence, benchmarks, leaderboard, and comparison
- New Run: harness, runner, suite, filters, samples, parallelism, and budget selection
- Cases: benchmark library and case definitions
- Accuracy: evidence tiers, oracle/known-bad coverage, and audit weaknesses
- Live: recent local trace intelligence
- Collection: cross-harness history, search, session detail, and timeline/impact analysis
- Harnesses and Settings: local runtime discovery and configuration

## 2. Provisional product thesis

Agent evaluation is difficult to trust when scores are detached from the underlying work. OpenEval should help a local operator answer, with inspectable evidence:

1. What did the agent actually do?
2. Did it complete the task correctly?
3. How repeatable, costly, and fast was the result?
4. What evidence is measured, inferred, missing, or still unknown?
5. How does one harness or model compare with another without hiding the caveats?

The central UX promise for this spec is broader than evaluation scoring:

> Anyone should be able to return to work they or an agent already did, understand what happened, locate what went wrong, and turn that evidence into a concrete improvement for the agent or workflow.

The experience should serve two audiences through the same evidence model:

- **Experienced operator:** wants dense navigation, exact trace/tool detail, filters, comparisons, provenance, and fast paths to a known session or failure.
- **First-time or non-technical user:** needs plain-language orientation, helpful defaults, progressive disclosure, visible “what happened / why it matters / what to do next” guidance, and recovery from unfamiliar terminology.

The product should not create two disconnected apps. The novice path should be a guided view over the same underlying sessions, transcripts, tool calls, artifacts, outcomes, and evidence that the expert can inspect in full.

## 2A. Target experience loop

The intended loop is:

```text
capture → find → understand → diagnose → improve → verify
```

1. **Capture:** retain a usable record of agent work, including transcript, tool calls, artifacts, outcome, and provenance.
2. **Find:** locate a past session by project, date, agent, task, outcome, tool, error, or free-text search.
3. **Understand:** provide a readable narrative summary before exposing the full technical trace.
4. **Diagnose:** distinguish agent mistake, task/setup problem, harness/provider failure, missing evidence, and unresolved uncertainty.
5. **Improve:** produce a concrete next action such as a correction prompt, reusable case, rubric/oracle improvement, harness fix, or agent handoff.
6. **Verify:** rerun or re-check the proposed improvement and show whether the failure changed without hiding the original evidence.

## 3. Existing product boundary

### In scope today

- Descriptor-driven harness adapters for agent CLIs
- Repeatable fixture-backed cases and weighted graders
- SQLite-backed local run history and artifacts
- Run progress, cancellation, case detail, transcripts, tools, grader output, and artifacts
- Cross-run comparison, benchmark diagnostics, leaderboard, and accuracy audits
- Local transcript discovery, bounded trace inspection, search, and timeline analysis
- Explicit evidence provenance and redaction boundaries

### Not yet assumed as a product promise

- Universal provider-authenticated success for every harness
- Pixel-quality truth from structural artifact checks alone
- Full assistive-technology validation or human visual review
- Cloud synchronization, multi-user collaboration, or hosted execution

## 4. Discovery decisions — partially resolved

### D1. Spec target

Are we specifying:

- the whole OpenEval product,
- the next major release,
- or one named feature/workflow?

Decision: `Product-wide UX-flow specification`, with the first implementation slice bounded around the capture → find → understand → diagnose → improve loop.

### D2. Primary user

Who is the first person this spec optimizes for?

- A solo engineer evaluating local agent CLIs
- An AI/platform engineer maintaining an evaluation suite
- A team lead comparing models and harnesses
- Another user you have in mind

Decision: `Two primary personas`: an experienced evaluation operator and a first-time/non-technical user. The spec must define a shared information architecture with progressive disclosure rather than separate product surfaces.

### D3. Highest-value job

What should become materially better after the work described by this spec?

Decision: `Make past agent work durable, understandable, searchable, diagnosable, and actionable so users can improve agents and workflows from real evidence.`

### D4. Success signal

What observable result would make you call the work successful? Examples include faster time from case definition to trustworthy comparison, fewer ambiguous outcomes, more repeatable runs, or a specific workflow becoming easy enough to use routinely.

Decision: `TBD` — candidate measures are time-to-first-understanding, time-to-find-a-known-failure, successful recovery from a failure to a concrete next action, and expert fast-path efficiency. We still need target thresholds and the baseline workflow to measure against.

### D5. Delivery boundary

What must be included, and what should explicitly stay out, for the first implementation slice?

Decision: `Recommended first slice`: unify the primary history/session journey across Dashboard, Live, Collection, Timeline, Run Detail, and case detail; add clear plain-language summaries, failure/attention routing, evidence-aware next actions, and an explicit improvement handoff contract. Keep cloud sync, multi-user collaboration, and broad harness execution changes out unless they become necessary for that handoff.

## 5. Planned final spec sections

Once D1–D5 are decided, this sheet will be expanded into the agreed spec format with:

- problem statement and user context
- goals, non-goals, and scope boundary
- user stories and acceptance criteria
- end-to-end workflow and states
- UX and route/component impact
- data, API, persistence, and security contracts
- evidence/provenance requirements
- performance and accessibility requirements
- implementation slices and dependency order
- validation plan and proof boundaries
- open questions, risks, and decision log

## 5A. First-pass user journeys

### Journey A — first-time user returns to past work

1. Lands on the dashboard and sees what is new, what is unfinished, and what needs attention in plain language.
2. Selects a recent session or an “investigate a problem” entry point without needing to understand Live, Collection, Timeline, or grader terminology first.
3. Reads a concise answer to “what happened?” with task, agent, project, outcome, duration, and evidence status.
4. Expands “show me why” to see the relevant transcript turns, tool calls/results, artifacts, and errors.
5. Chooses a suggested next action: retry, inspect missing evidence, create a reusable case, prepare an improvement prompt, or mark the issue understood.

### Journey B — experienced operator investigates a known failure

1. Uses global search, filters, saved views, or direct route navigation to locate a session/case.
2. Jumps directly to the failing phase, tool call, grader, artifact, or transcript match.
3. Compares the failure with a passing run or prior attempt while preserving source-qualified identity and denominators.
4. Selects the diagnosis and improvement action that matches the evidence.
5. Re-runs or hands off the improvement, then compares the new evidence against the original without overwriting history.

### Journey C — user saves a useful moment

The product must make it possible to preserve a session, transcript excerpt, failure, diagnosis, or improvement artifact as a durable reference. The exact save model is open: automatic local retention, explicit bookmarks/collections, exportable reports, or a combination.

## 5B. UX principles for the spec

- **Plain-language first, technical detail available:** lead with meaning and preserve exact evidence behind disclosure.
- **One history, multiple lenses:** Dashboard, Live, Collection, Timeline, and Run Detail should feel like views into the same session universe.
- **Every failure gets a next action:** when evidence supports one, show it; when it does not, say what is missing.
- **Never hide uncertainty:** distinguish measured, inferred, missing, malformed, stale, archived, incomplete, and unknown states.
- **Preserve the source:** raw transcripts remain authoritative; summaries, search indexes, and derived views remain bounded and traceable.
- **Do not overwrite learning history:** retries and improvements create linked attempts, not destructive edits to the original record.
- **Progressive disclosure over separate modes:** novice guidance and expert controls should coexist without forcing experts through tutorials.
- **Accessible and responsive by default:** keyboard, screen-reader, touch, narrow viewport, dark/light, loading, error, empty, and recovery states are part of the flow.

## 6. Decision log

| ID | Decision | Status | Rationale |
| --- | --- | --- | --- |
| D0 | Use the local checkout and its matching `origin/main` as the source baseline. | Confirmed | The supplied repository URL resolves to this project and both refs point to the same commit. |
| D1 | Spec target | Provisional | Product-wide UX flow centered on capture → find → understand → diagnose → improve. |
| D2 | Primary user | Confirmed | Experienced operators and first-time/non-technical users share one progressive-disclosure information architecture. |
| D3 | Highest-value job | Confirmed | Return to past agent work, understand it, find failures, and turn evidence into an improvement. |
| D4 | Success signal | Open | Need baseline workflow and target thresholds for time-to-understanding, failure discovery, actionability, and expert efficiency. |
| D5 | Delivery boundary | Recommended | Cross-route history/session journey and improvement handoff; keep cloud sync, collaboration, and broad execution changes out initially. |
