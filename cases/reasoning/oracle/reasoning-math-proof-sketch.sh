#!/usr/bin/env bash
set -euo pipefail
proof='Let S = 1 + 2 + 3 + ... + n. Write the sum forwards and backwards:
S = 1 + 2 + ... + (n-1) + n
S = n + (n-1) + ... + 2 + 1
Adding the two equations term by term gives 2S = (n+1) + (n+1) + ... + (n+1), with n copies of (n+1). Therefore 2S = n(n+1), and dividing by 2 yields S = n(n+1)/2.'
printf '%s\n' "$proof" > proof.txt
printf '%s\n' "$proof"
