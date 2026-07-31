#!/usr/bin/env bash
set -euo pipefail
cat > voxel-world.html <<'HTML'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>OpenEval Voxel World</title>
    <style>
      :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; background: #0a1021; color: #f6f8ff; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(circle at 50% 15%, #263b6a, #0a1021 68%); }
      main { width: min(960px, calc(100vw - 40px)); padding: 34px; border: 1px solid #354b78; border-radius: 28px; background: rgba(12, 20, 43, .88); box-shadow: 0 26px 80px rgba(0,0,0,.35); }
      h1 { margin: 0; letter-spacing: -.04em; }
      .lede { margin: 8px 0 0; color: #aab7d6; }
      .stage { height: 440px; margin-top: 28px; display: grid; place-items: center; perspective: 920px; overflow: hidden; border-radius: 20px; background: linear-gradient(#1e315b, #101a35); }
      .world { position: relative; width: 520px; height: 320px; transform-style: preserve-3d; transform: rotateX(58deg) rotateZ(45deg) rotateY(0deg); }
      .layer { position: absolute; inset: 0; transform-style: preserve-3d; }
      .layer--background { transform: translateZ(-56px) scale(.82); opacity: .84; }
      .layer--middle { transform: translateZ(18px) scale(.92); }
      .layer--foreground { transform: translateZ(82px); }
      .voxel { position: absolute; width: 62px; height: 62px; border: 1px solid rgba(8, 15, 31, .45); border-radius: 7px; background: #71c563; box-shadow: 14px 14px 0 #427c4d, 28px 28px 0 #2a573e; }
      .voxel--stone { background: #aebbd2; box-shadow: 14px 14px 0 #7385a7, 28px 28px 0 #4b5c80; }
      .voxel--amber { background: #d6a85e; box-shadow: 14px 14px 0 #9b713d, 28px 28px 0 #674b2e; }
      .v1 { left: 74px; top: 82px; } .v2 { left: 160px; top: 82px; } .v3 { left: 246px; top: 82px; }
      .v4 { left: 117px; top: 154px; } .v5 { left: 203px; top: 154px; } .v6 { left: 289px; top: 154px; }
      .v7 { left: 160px; top: 226px; } .v8 { left: 246px; top: 226px; } .v9 { left: 332px; top: 226px; }
      .legend { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 22px; color: #aab7d6; font-size: 13px; }
      .legend span::before { content: ""; display: inline-block; width: 10px; height: 10px; margin-right: 7px; border-radius: 3px; background: #71c563; }
      .legend span:nth-child(2)::before { background: #aebbd2; } .legend span:nth-child(3)::before { background: #d6a85e; }
    </style>
  </head>
  <body>
    <main>
      <h1>OpenEval Voxel World</h1>
      <p class="lede">A tiny CSS-built world with three depth layers and three materials.</p>
      <section class="stage" aria-label="Isometric voxel world">
        <div class="world">
          <div class="layer layer--background" data-iso-layer="background"><div class="voxel voxel--stone v1"></div><div class="voxel voxel--stone v2"></div><div class="voxel voxel--stone v3"></div></div>
          <div class="layer layer--middle" data-iso-layer="middle"><div class="voxel voxel--amber v4"></div><div class="voxel voxel--amber v5"></div><div class="voxel voxel--amber v6"></div></div>
          <div class="layer layer--foreground" data-iso-layer="foreground"><div class="voxel v7"></div><div class="voxel v8"></div><div class="voxel v9"></div></div>
        </div>
      </section>
      <div class="legend" aria-label="material legend"><span>grass</span><span>stone</span><span>amber earth</span></div>
    </main>
  </body>
</html>
HTML
