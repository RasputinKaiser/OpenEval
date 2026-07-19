/**
 * Minimal deterministic benchmark for the hottest path: live-session parsing
 * (lib/live.ts summarize*SessionFile). Real scans chew through hundreds of MB
 * of JSONL; this generates a fixed synthetic corpus from the golden fixtures
 * (never reads real session dirs, never touches data/live-cache.db) and times
 * cold parses (both cache tiers miss) and warm hits (in-process Map).
 *
 * Output is one line per measurement — stable keys, medians of 3 — so probe
 * runs can diff it. Corpus lives under OPENEVAL_DATA_ROOT (default .test-data),
 * regenerated only when missing or wrong size.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { summarizeCodexSessionFile, summarizeLiveSessionFile } from "../lib/live";
import { _setCacheDbForTest } from "../lib/live-cache";

const TARGET_BYTES = 32 * 1024 * 1024;
const FIXTURES = path.join(process.cwd(), "tests", "fixtures");
const BENCH_DIR = path.join(process.cwd(), process.env.OPENEVAL_DATA_ROOT ?? ".test-data", "bench");

const conn = new Database(":memory:");
_setCacheDbForTest(conn);

function buildCorpus(fixture: string, out: string): void {
  const lines = fs.readFileSync(path.join(FIXTURES, fixture), "utf8").split("\n").filter(Boolean);
  const block = lines.join("\n") + "\n";
  const reps = Math.ceil(TARGET_BYTES / Buffer.byteLength(block));
  fs.writeFileSync(out, block.repeat(reps));
}

function ensureCorpus(fixture: string, name: string): { paths: string[]; bytes: number } {
  fs.mkdirSync(BENCH_DIR, { recursive: true });
  const main = path.join(BENCH_DIR, `${name}.jsonl`);
  if (!fs.existsSync(main) || fs.statSync(main).size < TARGET_BYTES) buildCorpus(fixture, main);
  const paths = [main];
  // Cold parses need distinct paths (both cache tiers key on the path);
  // symlinks reuse the corpus bytes instead of copying 32MB per sample.
  for (let i = 1; i < 3; i++) {
    const link = path.join(BENCH_DIR, `${name}-cold${i}.jsonl`);
    if (!fs.existsSync(link)) fs.symlinkSync(main, link);
    paths.push(link);
  }
  return { paths, bytes: fs.statSync(main).size };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function bench(name: string, fixture: string, summarize: (file: string, projectDir: string, mtime: number) => unknown): void {
  const { paths, bytes } = ensureCorpus(fixture, name);
  const mtime = Date.parse("2026-01-05T10:10:30.000Z");
  const cold: number[] = [];
  for (const p of paths) {
    const t0 = performance.now();
    const session = summarize(p, "-bench-project", mtime);
    cold.push(performance.now() - t0);
    if (!session) throw new Error(`${name}: parser returned null — bench corpus no longer parses`);
  }
  const warm: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    summarize(paths[0], "-bench-project", mtime);
    warm.push(performance.now() - t0);
  }
  const coldMs = median(cold);
  const mbps = bytes / (1024 * 1024) / (coldMs / 1000);
  console.log(`${name} cold ${coldMs.toFixed(0)}ms ${mbps.toFixed(1)}MB/s (${(bytes / (1024 * 1024)).toFixed(0)}MB) | warm ${median(warm).toFixed(1)}ms`);
}

function main(): void {
  bench("claude-projects", "claude-interactive.jsonl", summarizeLiveSessionFile);
  bench("codex-sessions", "codex-rollout-new.jsonl", summarizeCodexSessionFile);
  _setCacheDbForTest(null);
  conn.close();
}
main();
