#!/usr/bin/env bash
set -euo pipefail
# Plausibly-wrong: a fixed three-column grid with NO responsive @media query,
# so it never collapses to a single column on narrow viewports.
cat > pricing.html <<'HTML'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>OpenEval Pricing</title>
    <link rel="stylesheet" href="pricing.css">
  </head>
  <body>
    <main data-testid="pricing" class="pricing">
      <header><h1>Choose your plan</h1></header>
      <section class="grid">
        <article data-testid="plan-card"><h2>Free</h2><p>$0</p></article>
        <article data-testid="plan-card"><h2>Team</h2><p>$49</p></article>
        <article data-testid="plan-card"><h2>Enterprise</h2><p>Contact us</p></article>
      </section>
    </main>
  </body>
</html>
HTML
cat > pricing.css <<'CSS'
body { margin: 0; background: #080a0f; color: #edf2f7; font-family: Inter, sans-serif; }
.pricing { max-width: 1080px; margin: 48px auto; }
.grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; }
[data-testid="plan-card"] { border: 1px solid #273142; padding: 24px; border-radius: 12px; }
CSS
