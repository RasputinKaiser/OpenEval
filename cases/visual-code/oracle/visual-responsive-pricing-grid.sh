#!/usr/bin/env bash
set -euo pipefail
cat > pricing.html <<'HTML'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>OpenEval Pricing</title>
    <link rel="stylesheet" href="pricing.css">
  </head>
  <body>
    <main data-testid="pricing" class="pricing">
      <header class="pricing__head">
        <h1>Choose your plan</h1>
        <p>Deterministic evals, known-bad rejection, and visual-code coverage — priced by team size.</p>
      </header>
      <section class="grid" aria-label="plans">
        <article data-testid="plan-card" class="card">
          <h2>Free</h2>
          <p class="price">$0</p>
          <ul><li>Single harness</li><li>Local runs</li></ul>
        </article>
        <article data-testid="plan-card" class="card card--featured">
          <h2>Team</h2>
          <p class="price">$49</p>
          <ul><li>Cross-harness pass@k</li><li>Shared dashboard</li></ul>
        </article>
        <article data-testid="plan-card" class="card">
          <h2>Enterprise</h2>
          <p class="price">Contact us</p>
          <ul><li>SSO + audit</li><li>Priority support</li></ul>
        </article>
      </section>
    </main>
  </body>
</html>
HTML
cat > pricing.css <<'CSS'
:root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
body { margin: 0; background: #080a0f; color: #edf2f7; }
.pricing { width: min(1080px, calc(100vw - 48px)); margin: 48px auto; }
.pricing__head h1 { margin: 0 0 8px; font-size: 40px; }
.pricing__head p { margin: 0 0 28px; max-width: 560px; color: #9aa4b2; line-height: 1.5; }
.grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; }
.card { border: 1px solid #273142; background: #111827; border-radius: 12px; padding: 24px; }
.card--featured { border-color: #7c5cff; }
.card h2 { margin: 0 0 12px; font-size: 22px; }
.price { font-size: 32px; font-weight: 700; margin: 0 0 16px; }
.card ul { margin: 0; padding-left: 18px; color: #9aa4b2; line-height: 1.7; }
@media (max-width: 640px) {
  .grid { grid-template-columns: 1fr; }
  .pricing__head h1 { font-size: 30px; }
}
CSS
