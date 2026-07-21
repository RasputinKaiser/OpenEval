#!/usr/bin/env bash
set -euo pipefail
# Wrong count: over-counts by also matching WARN lines (4 instead of 3).
# A naive "count the problem lines" attempt must be rejected by the graders.
grep -cE 'ERROR|WARN' log.txt > error-count.txt
