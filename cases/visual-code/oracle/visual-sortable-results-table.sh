#!/usr/bin/env bash
set -euo pipefail
cat > results-table.html <<'HTML'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Case Results</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      body { margin: 0; background: #080a0f; color: #edf2f7; }
      main { width: min(880px, calc(100vw - 48px)); margin: 40px auto; }
      h1 { font-size: 34px; margin: 0 0 20px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 12px 16px; border-bottom: 1px solid #273142; }
      th { color: #9aa4b2; cursor: pointer; user-select: none; background: #10151f; }
      th[aria-sort="ascending"]::after { content: " \25B2"; }
      th[aria-sort="descending"]::after { content: " \25BC"; }
    </style>
  </head>
  <body>
    <main data-testid="results-table">
      <h1>Case Results</h1>
      <table>
        <thead>
          <tr>
            <th scope="col" data-sort-key="case" aria-sort="none">Case</th>
            <th scope="col" data-sort-key="score" aria-sort="none">Score</th>
            <th scope="col" data-sort-key="status" aria-sort="none">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>visual-svg-status-card</td><td data-value="0.94">0.94</td><td>passed</td></tr>
          <tr><td>visual-web-eval-dashboard</td><td data-value="0.88">0.88</td><td>passed</td></tr>
          <tr><td>swe-fix-fizzbuzz</td><td data-value="0.71">0.71</td><td>failed</td></tr>
          <tr><td>single-tool-grep</td><td data-value="1.00">1.00</td><td>passed</td></tr>
        </tbody>
      </table>
    </main>
    <script>
      (function () {
        var table = document.querySelector("table");
        var tbody = table.querySelector("tbody");
        var headers = table.querySelectorAll("thead th[data-sort-key]");
        headers.forEach(function (th, colIndex) {
          th.addEventListener("click", function () {
            var current = th.getAttribute("aria-sort");
            var dir = current === "ascending" ? "descending" : "ascending";
            headers.forEach(function (h) { h.setAttribute("aria-sort", "none"); });
            th.setAttribute("aria-sort", dir);
            var rows = Array.prototype.slice.call(tbody.querySelectorAll("tr"));
            rows.sort(function (a, b) {
              var ca = a.children[colIndex];
              var cb = b.children[colIndex];
              var va = ca.getAttribute("data-value") || ca.textContent.trim();
              var vb = cb.getAttribute("data-value") || cb.textContent.trim();
              var na = parseFloat(va), nb = parseFloat(vb);
              var cmp = (!isNaN(na) && !isNaN(nb)) ? na - nb : va.localeCompare(vb);
              return dir === "ascending" ? cmp : -cmp;
            });
            rows.forEach(function (r) { tbody.appendChild(r); });
          });
        });
      })();
    </script>
  </body>
</html>
HTML
