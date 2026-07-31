#!/usr/bin/env bash
set -euo pipefail
# Plausible near-miss: uses the upper middle item instead of the median for an
# odd-length sorted list. All source files remain untouched.
cat > number-summary.json <<'EOF'
{
  "count": 9,
  "sum": 297,
  "min": 4,
  "max": 88,
  "median": 31
}
EOF
