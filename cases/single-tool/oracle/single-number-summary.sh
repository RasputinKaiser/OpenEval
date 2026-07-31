#!/usr/bin/env bash
set -euo pipefail
cat > number-summary.json <<'EOF'
{
  "count": 9,
  "sum": 297,
  "min": 4,
  "max": 88,
  "median": 23
}
EOF
