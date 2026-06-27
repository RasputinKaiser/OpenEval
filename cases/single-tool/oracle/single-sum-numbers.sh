#!/usr/bin/env bash
set -euo pipefail
awk '{s += $1} END {print s}' numbers.txt > sum.txt
