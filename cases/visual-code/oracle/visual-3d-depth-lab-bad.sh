#!/usr/bin/env bash
set -euo pipefail
# Plausibly-wrong: this preserves the heading and a layered layout but omits
# perspective, uses flat transforms, and exposes only two depth planes.
cat > depth-scene.html <<'HTML'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>OpenEval Depth Lab</title>
    <style>
      body { margin: 0; background: #10172a; color: white; font-family: sans-serif; }
      .stage { height: 320px; display: grid; place-items: center; }
      .world { width: 360px; height: 220px; transform-style: flat; }
      .layer { position: absolute; width: 240px; height: 140px; display: grid; place-items: center; }
      .back { transform: translateZ(-80px); background: #32446f; }
      .front { transform: translateZ(60px); background: #8c6ff0; }
    </style>
  </head>
  <body>
    <main><h1>OpenEval Depth Lab</h1><section class="stage"><div class="world">
      <div class="layer back" data-depth-layer="back">back plane</div>
      <div class="layer front" data-depth-layer="front">front plane</div>
    </div></section></main>
  </body>
</html>
HTML
