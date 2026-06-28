#!/usr/bin/env bash
set -euo pipefail
cat <<'EOF'
Restart the service to see if the failure clears. Then check the database and call the payment API provider to ask if they are having issues. Notify the team once service is back up.
EOF
