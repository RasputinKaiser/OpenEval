# Get your first OpenEval insight

## Install once

Use Node 22 and npm 10. With nvm, run `nvm install 22` and `nvm use 22`.
Alternatively install Node 22 from the [official Node downloads](https://nodejs.org/en/download).
Node 20 is end-of-life; the [official release schedule](https://github.com/nodejs/Release#release-schedule) lists the maintained versions.
OpenEval currently verifies Node 22; other majors are rejected by setup so native SQLite failures do not appear later as dashboard errors.

```bash
git clone --branch v0.2.0 --depth 1 https://github.com/RasputinKaiser/OpenEval.git
cd OpenEval
npm run setup
npm run open
```

Without Git, download and extract the repository source archive, open a terminal in that folder, and start at `npm run setup`.

Setup runs from a fresh checkout without requiring dependencies beforehand. It
uses `npm ci --include=dev`, tests an in-memory SQLite database, and builds the
application. A failed step stops with its output intact. Builds can take several
minutes. Rerunning setup reinstalls dependencies and rebuilds; it does not clear
transcript history, modify agent configuration, or create API credentials.

Open http://127.0.0.1:3000. `npm run open` binds only to loopback, keeps running
in the terminal, and stops with Ctrl+C. It never kills another process. If port
3000 is occupied, use `npm run open -- --port 3177`. Set the same
`OPENEVAL_BUILD_DIR` for setup and open if you use a custom build directory.

## Choose what you want to do

**Inspect work you already did:** open Collection. OpenEval discovers supported
local transcript locations automatically. Select a model, inspect its activity,
and explore a session. Authentication and API keys are not required for this
read-only workflow. No history yet? Use your agent normally once and re-scan.
Missing or unsupported source formats are shown explicitly; they do not count
as zero usage. For custom source locations, use Collection's source settings.

**Benchmark an agent:** open Harnesses to check the installed CLI, then New Run.
Authenticate the agent using its own CLI first. Start with a small case selection;
evaluation and optional LLM judging may use paid inference. Running an eval is
not a setup requirement.

No `.env` file is needed for default local use. `.env.example` describes optional
configuration; do not paste keys into the repository. Data lives under `data/`
in the checkout by default. Set `OPENEVAL_DATA_ROOT` consistently on setup/start
commands if using another location. That directory contains local databases and
workdirs, not a replacement for the agents' original transcript folders.

## Next time and updates

Open **Settings → OpenEval updates → Check for updates** to compare your installed
version with the latest stable GitHub release. This contacts GitHub only on demand;
it does not upload your transcripts. Open the release notes from that panel.

To install, stop OpenEval and any running evaluations. Save local source changes,
then run these commands in your existing checkout (replace the tag for a future release):

```bash
git status --short
git fetch origin --tags
# Continue with a clean checkout:
git switch --detach v0.2.0
npm run setup
npm run open
```

Keep your existing `data/` directory and environment settings. Source archives
without Git require downloading the new release archive and retaining the same
external `OPENEVAL_DATA_ROOT` or moving your existing data folder into the new
installation while both instances are stopped. Back up local data before upgrading.
The update panel does not install or restart the running server.


- Start again with `npm run open`; no install or rebuild is needed for an unchanged checkout.
- After updating source, stop OpenEval, then run `npm run setup` and `npm run open`.
- To keep an already verified dependency installation, use `npm run setup -- --skip-install`.
- For development, use `npm run setup -- --no-build`, then `npm run dev`. Stop dev before building into the same output directory.
- `npm run setup -- --check` checks the runtime and installed SQLite binding without writes.
- `npm run doctor` provides detailed environment/database diagnostics after installation.

## When something fails

| Symptom | Recovery |
| --- | --- |
| `npm` or `node` not found | Install Node 22, reopen the terminal, and check `node --version` and `npm --version`. |
| Wrong Node or npm major | Use Node 22 and npm 10. With nvm: `nvm use 22`. If needed, `npm install -g npm@10`. |
| Dependency download fails | Check network/proxy access to the npm registry, then rerun setup. No lockfile deletion is needed. |
| SQLite/native build fails | Use the supported Node version and rerun setup. If no prebuilt binary exists, install native compiler tools: Xcode Command Line Tools on macOS, a C/C++ toolchain and Python on Linux, or Visual Studio C++ build tools and Python on Windows. |
| Production build missing | Run `npm run setup`, then `npm run open`. |
| Port already in use | Choose another port with `npm run open -- --port 3177`. |
| No local sessions | Use a supported agent once, then re-scan Collection. Check source locations and coverage before expecting metrics. |
| Agent cannot run | Check Harnesses and authenticate through the agent's own CLI. Transcript inspection does not require a working runner. |

This pass verifies installation on macOS. Linux is covered by the repository CI
configuration; that CI job must run to establish a fresh Linux result. Windows
launcher arguments are portable, but native dependencies and shell-based graders
have not been validated here; WSL is an alternative for those workflows.
