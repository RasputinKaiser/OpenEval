#!/usr/bin/env bash
set -euo pipefail
cat > route-planner.html <<'HTML'
<!doctype html><html><body><h1>OpenEval Field Route</h1><div><span data-landmark="one">A</span><span data-landmark="two">B</span></div><p>Some map. Follow the colors.</p></body></html>
HTML
