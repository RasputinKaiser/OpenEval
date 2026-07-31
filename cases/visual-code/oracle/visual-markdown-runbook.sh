#!/usr/bin/env bash
set -euo pipefail
cat > RUNBOOK.md <<'MD'
# OpenEval Incident Runbook

## Situation

An evaluation run has produced a suspicious result or an incomplete evidence receipt. Pause publication and preserve the raw transcript before investigating.

## Decision

```mermaid
flowchart LR
  Queue --> Analyze
  Analyze --> Publish
  Analyze -->|reject| Review
```

| Signal | Action |
| --- | --- |
| Missing receipt | Hold publication and inspect the run |
| Known-bad fails open | Send the case to Review |

## Verification

Check the exact case, compare the deterministic grader output, and confirm that the transcript and artifact hashes refer to the same run.

## Rollback

Run `npm run audit:accuracy -- --strict` before changing the catalog. If the release is already published, use `git revert <commit>` and preserve the raw transcript; never delete it while investigating.

## Owner notes

Record the decision, evidence gaps, and next action in the run record.
MD
