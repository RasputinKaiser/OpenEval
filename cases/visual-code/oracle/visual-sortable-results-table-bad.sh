#!/usr/bin/env bash
set -euo pipefail
# Plausibly-wrong: a static results table with no sort-key attributes, no
# scope/aria-sort affordances, and no click handler — it renders but never sorts.
cat > results-table.html <<'HTML'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Case Results</title>
    <style>
      body { margin: 0; background: #080a0f; color: #edf2f7; font-family: Inter, sans-serif; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 12px 16px; border-bottom: 1px solid #273142; }
    </style>
  </head>
  <body>
    <main data-testid="results-table">
      <h1>Case Results</h1>
      <table>
        <thead>
          <tr><th>Case</th><th>Score</th><th>Status</th></tr>
        </thead>
        <tbody>
          <tr><td>visual-svg-status-card</td><td>0.94</td><td>passed</td></tr>
          <tr><td>visual-web-eval-dashboard</td><td>0.88</td><td>passed</td></tr>
          <tr><td>swe-fix-fizzbuzz</td><td>0.71</td><td>failed</td></tr>
        </tbody>
      </table>
    </main>
  </body>
</html>
HTML
