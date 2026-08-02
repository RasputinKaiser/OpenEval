# First Evidence Loop — Release Scope

## Audience

The primary user is a solo developer or AI/evaluation engineer who runs agent CLIs on a local machine and needs trustworthy evidence before changing a harness, model, prompt, rubric, or workflow. The same evidence model must also work for a first-time or non-technical operator through plain-language summaries and progressive disclosure; there is no separate novice application.

## Job to Be Done

When an operator needs to understand or improve agent behavior, they can connect or verify a local harness, discover prior work, understand one session quickly, inspect exact available evidence, run or judge a repeatable evaluation with an explicit backend, and re-check the result without losing provenance or the original record.

## Current Release

**Release name:** First Evidence Loop

**Activity boundary:** connect or verify a harness → collect existing evidence or run once → preserve authoritative evidence → understand a session → inspect transcript/tool/reasoning/error detail → choose a judge for a job → act through one evaluation handoff → re-check the linked result.

This release improves the existing product rather than rebuilding its dashboard. Dashboard, Live, Collection, Timeline, Runs, Compare, Leaderboard, Accuracy, responsive navigation, bounded list payloads, evidence provenance, SQLite durability, and global judge defaults already exist and remain the base.

## SLC Contract

- **Simple:** Custom connection uses validated descriptor JSON import/edit rather than a full visual descriptor builder. The act/re-check path is one source-qualified observation-to-evaluation handoff, not bookmarks, collaboration, or a workflow automation system.
- **Lovable:** A new operator sees a continuous measured path to first evidence, while an expert can skip guidance, use direct routes, and inspect raw or normalized detail without losing denominators or provenance.
- **Complete:** The path includes failure and recovery states, exact judge receipts, retained raw output for OpenEval-launched work, safe transcript continuation, and a linked re-check result. No step ends in an unexplained dead end.

## Product and Evidence Boundaries

- OpenEval stays free and local-first. No account, entitlement, payment SDK, credential vault, hosted database, cloud synchronization, or remote execution is introduced.
- Bundled Codex, Claude Code, and ncode descriptors remain immutable reference integrations. User descriptors may override them locally, but disconnecting a user registration reveals the bundled reference rather than deleting packaged code.
- Disconnecting a harness removes or disables only the OpenEval registration. It never deletes external transcripts, OpenEval run evidence, cached archived summaries, or evaluation history.
- For runs OpenEval launches, the raw CLI output is retained as the authoritative run transcript and normalized events remain a derived projection.
- For externally discovered sessions, the harness-owned file is authoritative while present. If the harness prunes it, OpenEval may retain a clearly labeled derived summary, but this release does not silently copy every external raw transcript.
- All population claims preserve source-qualified identity, denominators, and measured/inferred/missing/malformed/partial/unknown distinctions.
- The current dirty-tree reasoning work is existing implementation: this release completes parity and bounds; it does not schedule a second generic “add reasoning” feature.

## Success Measures

The release is accepted when the observable criteria in `IMPLEMENTATION_PLAN.md` pass in an isolated data root. Browser proof covers a first-time flow and an expert direct flow at desktop and 390px widths in dark and light themes. Performance proof records bounded initial/list payloads, first transcript window latency, continuation latency, and confirms continuation does not rescan the complete source from byte zero.

## Future Release

- Full field-by-field descriptor authoring and a descriptor marketplace.
- Provider login/OAuth management, credential storage, paid-provider smoke tests, and remote harness management.
- Automatic immutable archival of all externally discovered transcripts, pending an explicit quota/retention product decision.
- Bookmarks, saved views, shared collections, multi-user collaboration, cloud sync, and broad workflow automation.
- Advanced cross-session experiment organization and customizable analytics beyond the one complete act/re-check loop.
- Run tags, saved comparisons, and archive taxonomy beyond scale-safe cursor access to existing evaluation history.
