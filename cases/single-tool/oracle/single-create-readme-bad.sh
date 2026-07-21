#!/usr/bin/env bash
set -euo pipefail
# Incomplete README: writes the title but omits the required description body.
# file_exists passes, but the exact-content grader must reject the missing content.
printf '# Demo Project\n' > README.md
