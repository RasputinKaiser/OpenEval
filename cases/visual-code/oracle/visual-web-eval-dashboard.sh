#!/usr/bin/env bash
set -euo pipefail
cat > index.html <<'HTML'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>OpenEval Run Report</title>
    <link rel="stylesheet" href="styles.css">
  </head>
  <body>
    <main data-testid="eval-dashboard" class="shell">
      <header class="masthead">
        <h1>OpenEval Run Report</h1>
        <p>Deterministic evidence, known-bad rejection, and visual-code quality in one operator view.</p>
      </header>
      <section class="metrics" aria-label="run metrics">
        <article data-testid="metric-card"><span>Pass@1</span><strong>87%</strong></article>
        <article data-testid="metric-card"><span>Pass@k</span><strong>94%</strong></article>
        <article data-testid="metric-card"><span>Known-bad</span><strong>rejected</strong></article>
        <article data-testid="metric-card"><span>Visual-code</span><strong>2 cases</strong></article>
      </section>
      <svg data-testid="pass-chart" viewBox="0 0 640 180" role="img" aria-label="Pass rate trend chart">
        <rect x="0" y="0" width="640" height="180" rx="18" fill="#111827"></rect>
        <path d="M52 132 C140 84, 200 116, 288 72 S456 56, 588 34" fill="none" stroke="#7c5cff" stroke-width="8"></path>
        <rect x="52" y="100" width="36" height="42" fill="#56d4dd"></rect>
        <rect x="122" y="82" width="36" height="60" fill="#56d4dd"></rect>
        <rect x="192" y="64" width="36" height="78" fill="#56d4dd"></rect>
      </svg>
      <table data-testid="case-table">
        <thead><tr><th>Case</th><th>Evidence</th><th>Status</th></tr></thead>
        <tbody>
          <tr><td>visual-svg-status-card</td><td>artifact contract</td><td>passed</td></tr>
          <tr><td>swe-pipeline-multi-fix</td><td>tests + diff</td><td>passed</td></tr>
        </tbody>
      </table>
    </main>
  </body>
</html>
HTML
cat > styles.css <<'CSS'
:root {
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  background: #080a0f;
  color: #edf2f7;
}
body { margin: 0; min-height: 100vh; background: #080a0f; }
.shell { width: min(1120px, calc(100vw - 64px)); margin: 40px auto; display: grid; gap: 24px; }
.masthead { display: flex; align-items: end; justify-content: space-between; gap: 32px; }
.masthead h1 { margin: 0; font-size: 44px; letter-spacing: 0; }
.masthead p { margin: 0; max-width: 520px; color: #9aa4b2; line-height: 1.5; }
.metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
[data-testid="metric-card"] { border: 1px solid #273142; background: #111827; padding: 20px; border-radius: 8px; }
[data-testid="metric-card"] span { display: block; color: #9aa4b2; margin-bottom: 12px; }
[data-testid="metric-card"] strong { display: block; font-size: 28px; }
[data-testid="pass-chart"] { width: 100%; height: 220px; }
table { width: 100%; border-collapse: collapse; overflow: hidden; border-radius: 8px; }
th, td { text-align: left; padding: 15px 18px; border-bottom: 1px solid #273142; }
th { color: #9aa4b2; font-weight: 600; background: #10151f; }
td { background: #0f141d; }
CSS
