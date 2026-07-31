#!/usr/bin/env bash
set -euo pipefail
cat > depth-scene.html <<'HTML'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>OpenEval Depth Lab</title>
    <style>
      :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; background: #090d18; color: #f5f7ff; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #090d18; }
      .lab { width: min(900px, calc(100vw - 48px)); padding: 36px; border: 1px solid #293452; border-radius: 24px; background: #10172a; }
      h1 { margin: 0 0 8px; letter-spacing: -0.04em; }
      .lede { margin: 0; color: #aab7d6; }
      .depth-stage { height: 360px; margin-top: 28px; display: grid; place-items: center; perspective: 760px; overflow: hidden; border-radius: 18px; background: #151f38; }
      .world { position: relative; width: 420px; height: 250px; transform-style: preserve-3d; transform: rotateX(14deg) rotateY(-20deg); }
      .layer { position: absolute; inset: 0; display: grid; place-items: center; transform-style: preserve-3d; border: 1px solid #dce6ff; border-radius: 18px; box-shadow: 0 24px 40px rgba(0,0,0,.25); }
      .layer--back { transform: translateZ(-120px) scale(.76); background: #32446f; opacity: .72; }
      .layer--mid { transform: translateZ(-20px) scale(.88); background: #596fa6; opacity: .86; }
      .layer--front { transform: translateZ(100px); background: #8c6ff0; }
      .layer-label { padding: 10px 14px; border-radius: 999px; background: #10172a; color: #f5f7ff; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; }
      .legend { display: flex; gap: 18px; margin-top: 20px; color: #aab7d6; font-size: 13px; }
      .legend span::before { content: ""; display: inline-block; width: 10px; height: 10px; margin-right: 6px; border-radius: 50%; background: #8c6ff0; }
      .legend span:nth-child(2)::before { background: #596fa6; }
      .legend span:nth-child(3)::before { background: #32446f; }
    </style>
  </head>
  <body>
    <main class="lab">
      <h1>OpenEval Depth Lab</h1>
      <p class="lede">A bounded CSS study of three explicit depth planes.</p>
      <section class="depth-stage" aria-label="Three-layer depth scene">
        <div class="world">
          <div class="layer layer--back" data-depth-layer="back"><span class="layer-label">back plane</span></div>
          <div class="layer layer--mid" data-depth-layer="middle"><span class="layer-label">middle plane</span></div>
          <div class="layer layer--front" data-depth-layer="front"><span class="layer-label">front plane</span></div>
        </div>
      </section>
      <div class="legend" aria-label="depth legend"><span>front</span><span>middle</span><span>back</span></div>
    </main>
  </body>
</html>
HTML
