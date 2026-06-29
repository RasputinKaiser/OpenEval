#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

fail=0

tracked_local_patterns='(^|/)(data|\.codex|\.ncode|\.next|node_modules)(/|$)|(^|/)state\.yaml$|(^|/)tsconfig\.tsbuildinfo$|(^|/)\.DS_Store$'

echo "== OpenEval public upload audit =="
echo "repo: $root"
echo

echo "== Tracked local-only files =="
if git ls-files | rg -n "$tracked_local_patterns"; then
  echo "ERROR: local-only generated files are tracked."
  fail=1
else
  echo "ok: no local-only generated files are tracked."
fi
echo

echo "== Public identity scan =="
if git grep -n -i -I -- 'Ian Zvirbulis' -- . ':!scripts/public-upload-audit.sh'; then
  echo "ERROR: disallowed public-facing identity string found."
  fail=1
else
  echo "ok: disallowed public-facing identity string absent."
fi
echo

echo "== Private machine path scan =="
if git grep -n -I -E '/Users/ianzvirbulis|/Users/Ian|/Users/ian' -- . ':!scripts/public-upload-audit.sh'; then
  echo "ERROR: private machine path found in tracked files."
  fail=1
else
  echo "ok: private machine paths absent from tracked files."
fi
echo

echo "== Secret-like fixture inventory =="
git ls-files 'fixtures/**/*.env' 'fixtures/**/*SECRET*' 'fixtures/**/*LOCK*' | sed 's/^/fixture: /' || true
echo "note: the listed fixture files are intentional adversarial test data; review before publishing if the fixture set changes."
echo

if [ "$fail" -ne 0 ]; then
  echo "public upload audit failed"
  exit 1
fi

echo "public upload audit passed"
