#!/usr/bin/env bash
set -euo pipefail
# Plausibly-wrong: a flowchart that drops the Executor-->Grade edge and the
# labeled known-bad rejection edge, so the pipeline no longer connects end to end.
cat > pipeline.mmd <<'MMD'
flowchart TD
  SelectCases --> RunLoop
  RunLoop --> Executor
  Grade --> Persist
MMD
