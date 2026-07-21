#!/usr/bin/env bash
set -euo pipefail
# Near-miss: correct intermediate trace (evens -> 20, 40 -> sum 60) but a wrong
# final conclusion of 120 from imagining the reduce doubles the running total.
# Mentions the keyword "60" yet the stated answer is wrong.
cat <<'EOF'
The filter keeps 2 and 4, mapping by 10 gives 20 and 40, which add up to 60. The reduce then doubles that running total, so it prints 120.
EOF
