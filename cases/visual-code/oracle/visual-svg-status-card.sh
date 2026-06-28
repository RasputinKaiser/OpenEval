#!/usr/bin/env bash
set -euo pipefail
cat > status-card.svg <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" role="img" aria-labelledby="title desc">
  <title>NEval Accuracy Run status card</title>
  <desc>Dark evaluation status card showing pass rate, known-bad rejection coverage, and visual-code artifact checks.</desc>
  <rect width="800" height="500" rx="28" fill="#0b0d12"/>
  <rect x="48" y="44" width="704" height="412" rx="24" fill="#141821" stroke="#2f3545"/>
  <text x="84" y="104" fill="#f4f7fb" font-size="34" font-family="Inter, sans-serif">NEval Accuracy Run</text>
  <text x="84" y="154" fill="#9aa4b2" font-size="18" font-family="Inter, sans-serif">Pass rate</text>
  <text x="84" y="202" fill="#7ee787" font-size="52" font-family="Inter, sans-serif">92%</text>
  <text x="342" y="154" fill="#9aa4b2" font-size="18" font-family="Inter, sans-serif">Known-bad rejected</text>
  <text x="342" y="202" fill="#ffd166" font-size="52" font-family="Inter, sans-serif">8/8</text>
  <text x="600" y="154" fill="#9aa4b2" font-size="18" font-family="Inter, sans-serif">Visual-code</text>
  <text x="600" y="202" fill="#79c0ff" font-size="52" font-family="Inter, sans-serif">2</text>
  <rect x="92" y="330" width="52" height="54" rx="8" fill="#7c5cff"/>
  <rect x="166" y="292" width="52" height="92" rx="8" fill="#56d4dd"/>
  <rect x="240" y="254" width="52" height="130" rx="8" fill="#7ee787"/>
  <rect x="314" y="276" width="52" height="108" rx="8" fill="#ffd166"/>
  <path d="M430 370 C475 280, 520 310, 568 242 S662 258, 712 190" fill="none" stroke="#f778ba" stroke-width="8" stroke-linecap="round"/>
  <text x="92" y="420" fill="#9aa4b2" font-size="15" font-family="Inter, sans-serif">deterministic</text>
  <text x="430" y="420" fill="#9aa4b2" font-size="15" font-family="Inter, sans-serif">trend line</text>
</svg>
SVG
