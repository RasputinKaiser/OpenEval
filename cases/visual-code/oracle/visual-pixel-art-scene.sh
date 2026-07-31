#!/usr/bin/env bash
set -euo pipefail
cat > pixel-scene.svg <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" role="img" aria-labelledby="title">
  <title id="title">OpenEval Pixel Field</title>
  <rect width="320" height="200" fill="#1d3557" shape-rendering="crispEdges"/>
  <rect x="244" y="20" width="40" height="40" fill="#ffd166"/>
  <rect x="42" y="38" width="28" height="10" fill="#fff3b0"/>
  <rect x="54" y="28" width="30" height="20" fill="#fff3b0"/>
  <rect x="72" y="38" width="24" height="10" fill="#fff3b0"/>
  <rect x="0" y="126" width="320" height="74" fill="#2a9d8f"/>
  <rect x="0" y="126" width="320" height="10" fill="#152238"/>
  <rect x="28" y="116" width="36" height="10" fill="#2a9d8f"/>
  <rect x="42" y="106" width="28" height="20" fill="#2a9d8f"/>
  <rect x="76" y="136" width="18" height="18" fill="#e76f51"/>
  <rect x="100" y="148" width="18" height="18" fill="#152238"/>
  <rect x="128" y="136" width="18" height="18" fill="#e76f51"/>
  <rect x="154" y="154" width="18" height="18" fill="#152238"/>
  <rect x="188" y="132" width="18" height="18" fill="#e76f51"/>
  <rect x="218" y="146" width="18" height="18" fill="#152238"/>
  <rect x="250" y="132" width="18" height="18" fill="#e76f51"/>
  <rect x="282" y="152" width="18" height="18" fill="#152238"/>
  <rect x="12" y="164" width="184" height="26" fill="#152238"/>
  <rect x="208" y="174" width="12" height="12" fill="#ffd166"/>
  <rect x="224" y="174" width="12" height="12" fill="#e76f51"/>
  <rect x="240" y="174" width="12" height="12" fill="#ffd166"/>
  <text x="20" y="181" fill="#fff3b0" font-family="monospace" font-size="12">OpenEval Pixel Field</text>
</svg>
SVG
