#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

fail=0

# rg is preferred but optional. A missing binary must NOT read as "no matches":
# under `if git ls-files | rg ...`, command-not-found (127) is falsy and the
# check silently false-passes. Fall back to grep -E (same ERE dialect).
if command -v rg >/dev/null 2>&1; then
  pattern_scan() { rg -n "$1"; }
  scan_engine="rg"
else
  pattern_scan() { grep -nE "$1"; }
  scan_engine="grep -E (ripgrep not installed)"
fi

tracked_local_patterns='(^|/)(data|\.codex|\.ncode|\.next|node_modules)(/|$)|(^|/)state\.yaml$|(^|/)tsconfig\.tsbuildinfo$|(^|/)\.DS_Store$'

echo "== OpenEval public upload audit =="
echo "repo: $root"
echo "scan engine: $scan_engine"
echo

echo "== Tracked local-only files =="
if git ls-files | pattern_scan "$tracked_local_patterns"; then
  echo "ERROR: local-only generated files are tracked."
  fail=1
else
  echo "ok: no local-only generated files are tracked."
fi
echo

echo "== Public identity scan =="
# Keep the blocked value out of the public source while still enforcing it at
# runtime. Hex escapes are decoded by bash before git grep receives the value.
blocked_identity=$'\x49\x61\x6e\x20\x5a\x76\x69\x72\x62\x75\x6c\x69\x73'
if git grep -n -i -I -- "$blocked_identity" -- . ':!scripts/public-upload-audit.sh'; then
  echo "ERROR: disallowed public-facing identity string found."
  fail=1
else
  echo "ok: disallowed public-facing identity string absent."
fi
echo

echo "== Private machine path scan =="
blocked_user=$'\x69\x61\x6e\x7a\x76\x69\x72\x62\x75\x6c\x69\x73'
blocked_given=$'\x49\x61\x6e'
blocked_given_lower=$'\x69\x61\x6e'
if git grep -n -I -E "/Users/${blocked_user}|/Users/${blocked_given}|/Users/${blocked_given_lower}" -- . ':!scripts/public-upload-audit.sh'; then
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
