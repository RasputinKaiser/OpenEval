/* End-to-end scan benchmark: directory walk → stat → cache tiers → parse →
 * aggregate, over a deterministic on-disk corpus (claude-projects and
 * codex-sessions layouts, mixed file sizes, generated once from the golden
 * fixtures — real files, not symlinks: the walk skips non-regular entries).
 *
 * Three timings per source:
 *   cold — fresh cache DB, parses everything (parser + cachePut cost)
 *   warm — fresh PROCESS over the populated DB (stat + SQLite + JSON.parse),
 *          measured in a spawned child so the in-process Map is empty
 *   hot  — same process again (in-memory Map hits + aggregation only)
 *
 * Usage: npm run bench:scan  (sets OPENEVAL_DATA_ROOT=.test-data/scanbench-data;
 * the script refuses to run against any data root outside .test-data).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { scanSourceSessions, type CollectionSourceSpec } from "../../lib/live";

const REPO = path.join(__dirname, "..", "..");
const DATA_ROOT = process.env.OPENEVAL_DATA_ROOT ?? "";
if (!path.resolve(REPO, DATA_ROOT).startsWith(path.join(REPO, ".test-data"))) {
  console.error("scan-bench refuses to run outside .test-data — use `npm run bench:scan` (OPENEVAL_DATA_ROOT=.test-data/scanbench-data). This protects the real data/live-cache.db.");
  process.exit(1);
}

const CORPUS = path.join(REPO, ".test-data", "scanbench", "roots");
const FIXTURES = path.join(REPO, "tests", "fixtures");
const SIZES_KB = [64, 128, 256, 512, 1024, 2048, 4096];

function block(fixture: string): string {
  const lines = fs.readFileSync(path.join(FIXTURES, fixture), "utf8").split("\n").filter(Boolean);
  return lines.join("\n") + "\n";
}

function writeSized(file: string, blk: string, kb: number): void {
  const reps = Math.max(1, Math.ceil((kb * 1024) / Buffer.byteLength(blk)));
  fs.writeFileSync(file, blk.repeat(reps));
}

function ensureCorpus(): void {
  if (fs.existsSync(path.join(CORPUS, ".complete"))) return;
  fs.rmSync(CORPUS, { recursive: true, force: true });
  const claudeBlk = block("claude-interactive.jsonl");
  for (let p = 0; p < 6; p++) {
    const dir = path.join(CORPUS, "claude", `-bench-project-${p}`);
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 10; i++) {
      writeSized(path.join(dir, `session-${p}-${i}.jsonl`), claudeBlk, SIZES_KB[(p * 10 + i) % SIZES_KB.length]);
    }
  }
  const codexBlk = block("codex-rollout-new.jsonl");
  for (let i = 0; i < 30; i++) {
    const dir = path.join(CORPUS, "codex", "2026", "07", String((i % 30) + 1).padStart(2, "0"));
    fs.mkdirSync(dir, { recursive: true });
    writeSized(path.join(dir, `rollout-2026-07-${String((i % 30) + 1).padStart(2, "0")}-${i}.jsonl`), codexBlk, SIZES_KB[i % SIZES_KB.length] / 2);
  }
  fs.writeFileSync(path.join(CORPUS, ".complete"), "1");
}

const SPECS: CollectionSourceSpec[] = [
  { id: "bench-claude", label: "bench claude", roots: [path.join(CORPUS, "claude")], format: "claude-projects" },
  { id: "bench-codex", label: "bench codex", roots: [path.join(CORPUS, "codex")], format: "codex-sessions", maxDepth: 5 },
];

function scanAll(): { ms: number; sessions: number } {
  const t0 = performance.now();
  let sessions = 0;
  for (const spec of SPECS) {
    const agg = scanSourceSessions(spec, 10_000);
    sessions += agg.sessions.length;
  }
  return { ms: performance.now() - t0, sessions };
}

function main(): void {
  ensureCorpus();
  if (process.argv.includes("--child")) {
    // Fresh process over a populated DB = the restart-warm path.
    const warm = scanAll();
    console.log(`CHILD warm ${warm.ms.toFixed(0)}ms sessions=${warm.sessions}`);
    return;
  }
  const dbDir = path.join(path.resolve(REPO, DATA_ROOT), "data");
  fs.rmSync(dbDir, { recursive: true, force: true });
  const cold = scanAll();
  const hot = scanAll();
  const totalMb = 6 * 10 * SIZES_KB.reduce((a, b) => a + b, 0) / SIZES_KB.length / 1024 +
    30 * SIZES_KB.reduce((a, b) => a + b, 0) / SIZES_KB.length / 2 / 1024;
  console.log(`cold ${cold.ms.toFixed(0)}ms (${(totalMb / (cold.ms / 1000)).toFixed(1)}MB/s, ~${totalMb.toFixed(0)}MB, ${cold.sessions} sessions)`);
  const child = spawnSync(process.execPath, ["--import", "tsx", __filename, "--child"], {
    cwd: REPO, env: process.env, encoding: "utf8",
  });
  const m = child.stdout?.match(/CHILD warm (\d+)ms sessions=(\d+)/);
  if (m) {
    if (Number(m[2]) !== cold.sessions) throw new Error(`warm sessions ${m[2]} != cold ${cold.sessions}`);
    console.log(`warm ${m[1]}ms (fresh process, SQLite hits)`);
  } else {
    console.log(`warm FAILED: ${child.stderr?.slice(0, 500)}`);
    process.exitCode = 1;
  }
  console.log(`hot  ${hot.ms.toFixed(0)}ms (in-process Map hits)`);
}
main();
