# OpenEval probe suite — label | runs | command
# Dev loop per .claude/skills/openeval-dev-loop: tsc + node:test via tsx + next lint.
# `build` is runs=1 and MUST NOT run while a dev server serves THIS checkout
# (next build clobbers .next and the dev server 500s until restart).
# Tests use OPENEVAL_DATA_ROOT=.test-data (set inside the npm script) — isolated from data/.
types | 1 | npx tsc --noEmit
test  | 3 | npm test --silent
lint  | 1 | npm run lint --silent
build | 1 | npm run build --silent
