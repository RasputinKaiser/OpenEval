/* In-process A/B of baseline (oldlib snapshot) vs
 * patched (lib) parsers. Both module graphs live in one process — same JIT,
 * GC, and machine load; symlinked corpus paths give each graph its own cold
 * parse of page-cache-warm bytes, so samples isolate CPU parse cost. Order
 * alternates AB/BA per iteration to cancel ordering bias.
 *
 * Usage: snapshot the baseline first —
 *   git stash push lib/… && cp -R lib .test-data/oldlib && git stash pop
 * then `npx tsx scripts/perf/ab-compare.ts` with the patched tree in place.
 * (.test-data/bench corpora come from `npm run bench:live`.) */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { summarizeLiveSessionFile as newClaude, summarizeCodexSessionFile as newCodex } from "../../lib/live";
import { _setCacheDbForTest as setNew } from "../../lib/live-cache";

// The baseline graph only exists after the snapshot step in the usage notes,
// so load it dynamically — a static import would break typecheck (and every
// tsc run) whenever no A/B is in flight.
const OLDLIB = path.join(__dirname, "..", "..", ".test-data", "oldlib");
if (!fs.existsSync(path.join(OLDLIB, "live.ts"))) {
  console.error("No baseline snapshot at .test-data/oldlib — run the snapshot step from this file's header first.");
  process.exit(1);
}
/* eslint-disable @typescript-eslint/no-var-requires */
const oldLive = require(path.join(OLDLIB, "live")) as typeof import("../../lib/live");
const oldCache = require(path.join(OLDLIB, "live-cache")) as typeof import("../../lib/live-cache");
const oldClaude = oldLive.summarizeLiveSessionFile;
const oldCodex = oldLive.summarizeCodexSessionFile;
const setOld = oldCache._setCacheDbForTest;

const BENCH = path.join(__dirname, "..", "..", ".test-data", "bench");
const MTIME = Date.parse("2026-01-05T10:10:30.000Z");
const ITER = 8;

const connNew = new Database(":memory:");
const connOld = new Database(":memory:");
setNew(connNew);
setOld(connOld);

function links(name: string, n: number): string[] {
  const main = path.join(BENCH, `${name}.jsonl`);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const link = path.join(BENCH, `${name}-cmp${i}.jsonl`);
    if (!fs.existsSync(link)) fs.symlinkSync(main, link);
    out.push(link);
  }
  return out;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function run(label: string, oldFn: (f: string, p: string, m: number) => unknown, newFn: (f: string, p: string, m: number) => unknown) {
  const paths = links(label, ITER + 1);
  // warmup: JIT both graphs, and pull corpus bytes into the OS page cache
  oldFn(paths[ITER], "-ab", MTIME);
  newFn(paths[ITER], "-ab", MTIME);
  const oldMs: number[] = [];
  const newMs: number[] = [];
  for (let i = 0; i < ITER; i++) {
    const first = i % 2 === 0 ? "old" : "new";
    for (const side of first === "old" ? ["old", "new"] : ["new", "old"]) {
      const t0 = performance.now();
      const r = side === "old" ? oldFn(paths[i], "-ab", MTIME) : newFn(paths[i], "-ab", MTIME);
      const dt = performance.now() - t0;
      if (!r) throw new Error(`${label}/${side}: parser returned null`);
      (side === "old" ? oldMs : newMs).push(dt);
    }
  }
  const om = median(oldMs), nm = median(newMs);
  console.log(`${label}: old ${om.toFixed(0)}ms new ${nm.toFixed(0)}ms  (${((1 - nm / om) * 100).toFixed(1)}% faster)`);
  console.log(`  old samples: ${oldMs.map((x) => x.toFixed(0)).join(" ")}`);
  console.log(`  new samples: ${newMs.map((x) => x.toFixed(0)).join(" ")}`);
}

run("claude-projects", oldClaude, newClaude);
run("codex-sessions", oldCodex, newCodex);
setNew(null);
setOld(null);
connNew.close();
connOld.close();
