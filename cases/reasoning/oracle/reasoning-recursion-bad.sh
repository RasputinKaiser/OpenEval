#!/usr/bin/env bash
set -euo pipefail
# Near-miss: contains the incidental keyword "itself" but describes a loop, not
# a function calling itself. This is a wrong definition of recursion.
cat <<'EOF'
Recursion is when a loop in a program keeps repeating itself over and over until a stopping condition is finally met.
EOF
