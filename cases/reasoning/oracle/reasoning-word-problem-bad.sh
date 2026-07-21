#!/usr/bin/env bash
set -euo pipefail
# Near-miss: floats "11pm" as a tempting first guess (so it contains the keyword)
# but concludes with the wrong final answer of 1:00am.
cat <<'EOF'
At first glance the second train seems to catch up around 11pm, but after redoing the head-start arithmetic it actually reaches the first train at 1:00am the next day.
EOF
