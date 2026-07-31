#!/usr/bin/env bash
set -euo pipefail
cat > outcome-story.html <<'HTML'
<!doctype html><html><body><h1>OpenEval Outcome Story</h1><div><span data-metric="one">87</span><span data-metric="two">92</span></div><div data-bar="one"></div></body></html>
HTML
