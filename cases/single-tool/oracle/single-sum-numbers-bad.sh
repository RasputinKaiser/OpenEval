#!/usr/bin/env bash
set -euo pipefail
# Wrong sum: off-by-one truncation drops the last integer (266 instead of 297).
# An attempt that fails to read the whole file must be rejected by the graders.
head -n 8 numbers.txt | awk '{s += $1} END {printf "%d", s}' > sum.txt
