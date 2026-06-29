# Security Policy

OpenEval is local-first software. It reads local case fixtures, invokes local agent CLI harnesses, and stores run data in a local SQLite database under `data/`.

## Supported Versions

Security updates are handled on the main branch while the project is pre-1.0.

| Version | Supported |
| --- | --- |
| `main` | Yes |
| `< 0.1.0` | No |

## Reporting a Vulnerability

Please do not open a public issue with secrets, private transcripts, API keys, tokens, credentials, proprietary code, or machine-specific logs.

For now, report security-sensitive issues through a private GitHub security advisory on the repository if available. If that is unavailable, open a minimal public issue that describes the class of problem without including private data, and ask for a private coordination path.

Useful reports include:

- A concise description of the issue.
- The affected route, script, adapter, grader, or harness.
- Reproduction steps using synthetic fixtures only.
- Whether the issue can expose local transcripts, workdirs, paths, credentials, or provider tokens.
- The expected boundary and the observed behavior.

## Local Data Boundaries

These paths are local-only and should not be included in public reports:

- `data/eval.db`
- `data/eval.db-wal`
- `data/eval.db-shm`
- `data/transcripts/`
- `data/workdirs/`
- `.codex/`
- `.ncode/`
- `state.yaml`

Run `bash scripts/public-upload-audit.sh` before sharing repository snapshots.
