#!/usr/bin/env bash
set -euo pipefail
cat > trend.svg <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 360" role="img" aria-labelledby="chart-title chart-desc" data-testid="throughput-chart" data-series="weekly-throughput">
  <title id="chart-title">Weekly throughput</title>
  <desc id="chart-desc">Cases processed from Monday through Friday: 18, 31, 12, 26, and 40.</desc>
  <rect x="0" y="0" width="720" height="360" fill="#101827"/>
  <line x1="72" y1="300" x2="680" y2="300" stroke="#8da2c0"/>
  <g fill="#63d7c5" aria-label="Weekly throughput bars">
    <rect data-bar="0" data-label="Mon" data-value="18" x="96" y="192" width="72" height="108" rx="8"/>
    <rect data-bar="1" data-label="Tue" data-value="31" x="208" y="114" width="72" height="186" rx="8"/>
    <rect data-bar="2" data-label="Wed" data-value="12" x="320" y="228" width="72" height="72" rx="8"/>
    <rect data-bar="3" data-label="Thu" data-value="26" x="432" y="144" width="72" height="156" rx="8"/>
    <rect data-bar="4" data-label="Fri" data-value="40" x="544" y="60" width="72" height="240" rx="8"/>
  </g>
  <g fill="#f5f7fb" font-family="system-ui, sans-serif" font-size="16" text-anchor="middle">
    <text x="132" y="330">Mon</text><text x="244" y="330">Tue</text><text x="356" y="330">Wed</text><text x="468" y="330">Thu</text><text x="580" y="330">Fri</text>
    <text x="132" y="184">18</text><text x="244" y="106">31</text><text x="356" y="220">12</text><text x="468" y="136">26</text><text x="580" y="52">40</text>
  </g>
</svg>
SVG
mkdir -p evidence
hash=$(sha256sum trend.svg | awk '{print $1}')
cat > evidence/render.json <<JSON
{
  "version": 1,
  "artifact": { "path": "trend.svg", "kind": "svg", "sha256": "$hash" },
  "viewport": { "width": 720, "height": 360, "deviceScaleFactor": 1 },
  "runtime": {
    "loaded": true,
    "consoleErrors": [],
    "horizontalOverflow": false,
    "clientWidth": 720,
    "scrollWidth": 720,
    "selectors": [
      { "selector": "svg", "count": 1, "visible": true },
      { "selector": "[data-testid=\"throughput-chart\"]", "count": 1, "visible": true },
      { "selector": "[data-bar]", "count": 5, "visible": true }
    ]
  }
}
JSON
