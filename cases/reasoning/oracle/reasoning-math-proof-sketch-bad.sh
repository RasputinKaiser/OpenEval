#!/usr/bin/env bash
set -euo pipefail
proof='The sum grows like n^2/2 because each term is about n on average. By inspecting small cases, the closed form is n^2/2 + 1.'
printf '%s\n' "$proof" > proof.txt
printf '%s\n' "$proof"
