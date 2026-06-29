# Support

OpenEval is currently a local-first developer tool. The fastest way to get useful help is to provide a small, synthetic reproduction.

## Before Opening an Issue

Run:

```bash
npm run typecheck
npm run lint -- --max-warnings=0
npm run test:live
bash scripts/public-upload-audit.sh
```

For harness or CLI problems, also run:

```bash
npm run run:eval -- --list-harnesses
```

## What to Include

Good support reports include:

- OpenEval version or commit SHA.
- Node version.
- Operating system.
- The route, script, case, grader, or harness involved.
- The command you ran.
- A synthetic reproduction or fixture.
- Whether the issue affects local run data, trace parsing, grading, or UI display.

Do not include real secrets, provider tokens, private transcripts, local database files, or proprietary run output.
