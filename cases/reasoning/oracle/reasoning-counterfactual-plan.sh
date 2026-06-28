#!/usr/bin/env bash
set -euo pipefail
cat <<'EOF'
1. Roll back the deployment immediately to the last known-good production version so the service is restored while limiting blast radius.
2. Inspect CI logs, application logs, database connection metrics, and payment API response times to identify whether the failure is in the app layer, database, or external dependency.
3. Reproduce the failure in staging, apply a targeted fix (e.g., connection pool tuning, API timeout handling, or schema migration), and redeploy only after the fix passes automated health checks.
EOF
