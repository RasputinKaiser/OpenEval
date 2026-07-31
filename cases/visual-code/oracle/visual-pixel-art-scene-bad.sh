#!/usr/bin/env bash
set -euo pipefail
# Plausibly-wrong: the title and blocky scene remain, but the canvas contract,
# pixel density, and palette limit are violated.
cat > pixel-scene.svg <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
  <title>OpenEval Pixel Field</title>
  <rect width="320" height="180" fill="#1d3557"/>
  <rect x="240" y="20" width="40" height="40" fill="#ffd166"/>
  <rect x="0" y="120" width="320" height="60" fill="#2a9d8f"/>
  <rect x="20" y="130" width="24" height="24" fill="#e76f51"/>
  <rect x="54" y="130" width="24" height="24" fill="#152238"/>
  <rect x="88" y="130" width="24" height="24" fill="#8ecae6"/>
  <rect x="122" y="130" width="24" height="24" fill="#ffb703"/>
  <rect x="156" y="130" width="24" height="24" fill="#219ebc"/>
  <rect x="190" y="130" width="24" height="24" fill="#fb8500"/>
  <rect x="224" y="130" width="24" height="24" fill="#8338ec"/>
  <rect x="258" y="130" width="24" height="24" fill="#ff006e"/>
  <text x="20" y="112" fill="#fff3b0">OpenEval Pixel Field</text>
</svg>
SVG
