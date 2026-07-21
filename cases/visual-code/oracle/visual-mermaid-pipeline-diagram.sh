#!/usr/bin/env bash
set -euo pipefail
cat > pipeline.mmd <<'MMD'
flowchart TD
  SelectCases --> RunLoop
  RunLoop --> Executor
  Executor --> Grade
  Grade --> Persist
  Grade -->|known-bad| Persist
MMD
