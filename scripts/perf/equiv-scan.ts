/* Scan-layer equivalence hash for behavior-preserving refactors of the
 * walk/cache/aggregate pipeline. Clones the scanbench corpus, cold-
 * scans (populating a private cache DB), deletes every 7th file (making them
 * archived candidates), then hashes scanSourceSessions output across configs.
 * Usage: OPENEVAL_DATA_ROOT=.test-data/equivscan-data npx tsx scripts/perf/equiv-scan.ts
 * once on baseline code and once on patched code (corpus from `npm run
 * bench:scan` must exist); the printed hashes must be identical. staleMs is
 * normalized; clone mtimes and sessionIds are pinned deterministically. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { scanSourceSessions, type CollectionSourceSpec } from "../../lib/live";

const REPO = path.join(__dirname, "..", "..");
if (!(process.env.OPENEVAL_DATA_ROOT ?? "").includes(".test-data")) {
  console.error("refusing: set OPENEVAL_DATA_ROOT under .test-data");
  process.exit(1);
}
const SRC = path.join(REPO, ".test-data", "scanbench", "roots");
const CORPUS = path.join(REPO, ".test-data", "equivscan", "roots");

fs.rmSync(path.join(REPO, process.env.OPENEVAL_DATA_ROOT!, "data"), { recursive: true, force: true });
fs.rmSync(CORPUS, { recursive: true, force: true });
fs.cpSync(SRC, CORPUS, { recursive: true });

// The bench corpus repeats fixture content verbatim, so every file shares one
// sessionId — and the archived merge dedupes on sessionId, which would leave
// the archived path untested. Give each clone a distinct id.
let idx = 0;
const rewriteIds = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) { rewriteIds(full); continue; }
    if (!e.name.endsWith(".jsonl")) continue;
    const unique = `eq-session-${idx++}`;
    fs.writeFileSync(full, fs.readFileSync(full, "utf8")
      .replaceAll("golden-claude-interactive", unique)
      .replaceAll("golden-codex-new", unique));
    // lastEventAt seeds from mtime (clone time > record timestamps), so
    // deterministic mtimes are required for run-to-run comparable hashes.
    const fixed = new Date(Date.parse("2026-02-01T00:00:00.000Z") + idx * 1000);
    fs.utimesSync(full, fixed, fixed);
  }
};
rewriteIds(CORPUS);

const SPECS: CollectionSourceSpec[] = [
  { id: "eq-claude", label: "eq claude", roots: [path.join(CORPUS, "claude")], format: "claude-projects" },
  { id: "eq-codex", label: "eq codex", roots: [path.join(CORPUS, "codex")], format: "codex-sessions", maxDepth: 5 },
];

function hashOf(v: unknown): string {
  const json = JSON.stringify(v, (k, val) => (k === "staleMs" ? 0 : val));
  return crypto.createHash("sha256").update(json).digest("hex").slice(0, 20) + `:${json.length}`;
}

// Pass 1: populate the cache.
for (const spec of SPECS) scanSourceSessions(spec, 10_000, { includeArchived: false });

// Prune every 7th file (deterministic order) → archived candidates.
const all: string[] = [];
const walk = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith(".jsonl")) all.push(full);
  }
};
walk(CORPUS);
const pruned = all.filter((_, i) => i % 7 === 0);
for (const f of pruned) fs.rmSync(f);
console.log(`corpus ${all.length} files, pruned ${pruned.length}`);

for (const spec of SPECS) {
  for (const includeArchived of [false, true]) {
    for (const limit of [10, 10_000]) {
      const agg = scanSourceSessions(spec, limit, { includeArchived });
      console.log(`${spec.id} archived=${includeArchived} limit=${limit}: sessions=${agg.sessions.length} archived=${agg.archivedSessions} ${hashOf(agg)}`);
    }
  }
}
