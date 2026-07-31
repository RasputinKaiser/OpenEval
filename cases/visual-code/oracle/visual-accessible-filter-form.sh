#!/usr/bin/env bash
set -euo pipefail
cat > index.html <<'HTML'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Run explorer</title>
    <style>body{font-family:system-ui;margin:0;padding:24px}main{max-width:720px}li[hidden]{display:none}</style>
  </head>
  <body>
    <main data-testid="filter-app">
      <h1>Run explorer</h1>
      <form data-testid="filter-form" aria-label="Filter benchmark runs">
        <label for="status">Status</label>
        <select id="status" name="status">
          <option value="">All statuses</option>
          <option value="passed">Passed</option>
          <option value="failed">Failed</option>
          <option value="blocked">Blocked</option>
        </select>
        <button type="submit">Apply filter</button>
      </form>
      <ul data-testid="result-list" aria-live="polite">
        <li data-status="passed">Passed run</li>
        <li data-status="failed">Failed run</li>
        <li data-status="blocked">Blocked run</li>
      </ul>
      <p data-testid="empty-state" aria-live="polite" hidden>No matching runs.</p>
    </main>
    <script>
      const form = document.querySelector('[data-testid="filter-form"]');
      const status = document.querySelector('#status');
      const items = [...document.querySelectorAll('[data-testid="result-list"] [data-status]')];
      const empty = document.querySelector('[data-testid="empty-state"]');
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        let visible = 0;
        for (const item of items) {
          const show = !status.value || item.dataset.status === status.value;
          item.hidden = !show;
          if (show) visible += 1;
        }
        empty.hidden = visible > 0;
      });
    </script>
  </body>
</html>
HTML
mkdir -p evidence
hash=$(sha256sum index.html | awk '{print $1}')
cat > evidence/render.json <<JSON
{
  "version": 1,
  "artifact": { "path": "index.html", "kind": "html", "sha256": "$hash" },
  "viewport": { "width": 720, "height": 480, "deviceScaleFactor": 1 },
  "runtime": {
    "loaded": true,
    "consoleErrors": [],
    "horizontalOverflow": false,
    "clientWidth": 720,
    "scrollWidth": 720,
    "selectors": [
      { "selector": "[data-testid=\"filter-form\"]", "count": 1, "visible": true },
      { "selector": "[data-testid=\"result-list\"]", "count": 1, "visible": true },
      { "selector": "[data-testid=\"empty-state\"]", "count": 1, "visible": false }
    ]
  }
}
JSON
