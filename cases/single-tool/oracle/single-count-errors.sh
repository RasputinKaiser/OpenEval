#!/usr/bin/env bash
set -euo pipefail
grep -c 'ERROR' log.txt > error-count.txt
