#!/usr/bin/env bash
set -euo pipefail
cat > index.html <<'HTML'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>NEval Run Report</title>
    <link rel="stylesheet" href="styles.css">
  </head>
  <body>
    <main data-testid="eval-dashboard" class="shell" style="display:flex;flex-direction:column;padding:2rem;">
      <header class="masthead">
        <h1>NEval Run Report</h1>
        <p>Automated evaluation dashboard</p>
      </header>
      <section class="metrics" style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;">
        <div data-testid="metric-card" class="card">
          <span class="label">Pass@1</span>
          <span class="value">87%</span>
        </div>
        <div data-testid="metric-card" class="card">
          <span class="label">Pass@k</span>
          <span class="value">93%</span>
        </div>
        <div data-testid="metric-card" class="card">
          <span class="label">Visual-code</span>
          <span class="value">2</span>
        </div>
      </section>
      <section class="chart-area" style="display:flex;align-items:center;justify-content:center;height:200px;">
        <div class="placeholder">Chart area — pass distribution</div>
      </section>
    </main>
  </body>
</html>
HTML
cat > styles.css <<'CSS'
body { margin: 0; font-family: Inter, sans-serif; background: #0b0d12; color: #f4f7fb; }
.shell { max-width: 960px; margin: 0 auto; }
.masthead h1 { font-size: 1.5rem; }
.card { border: 1px solid #2f3545; border-radius: 8px; padding: 1rem; }
.label { font-size: 0.75rem; color: #9aa4b2; }
.value { font-size: 1.5rem; font-weight: 600; }
.placeholder { color: #57606a; }
CSS