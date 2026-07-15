import path from "node:path";
import fs from "node:fs";

/** The checkout the process runs from. Repo CONTENT (cases/, fixtures/) always resolves here. */
export const REPO_ROOT = path.resolve(process.cwd());

/**
 * Root for MUTABLE state: data/ (eval.db, live-cache.db, workdirs, transcripts)
 * and the user harness-descriptor dir. Normally the repo root, but
 * OPENEVAL_DATA_ROOT redirects it (npm test sets `.test-data`) so test runs can
 * never touch the operator's real databases or registered harnesses.
 * lib/live-cache.ts derives data/live-cache.db from this export.
 */
export const ROOT = process.env.OPENEVAL_DATA_ROOT
  ? path.resolve(REPO_ROOT, process.env.OPENEVAL_DATA_ROOT)
  : REPO_ROOT;

export const DB_PATH = path.join(ROOT, "data", "eval.db");
export const CASES_DIR = path.join(REPO_ROOT, "cases");
export const FIXTURES_DIR = path.join(REPO_ROOT, "fixtures");
export const WORKDIRS_DIR = path.join(ROOT, "data", "workdirs");
export const TRANSCRIPTS_DIR = path.join(ROOT, "data", "transcripts");
export const HARNESS_DESC_DIR = path.join(ROOT, "harnesses");


export function ensureDirs() {
  for (const dir of [WORKDIRS_DIR, TRANSCRIPTS_DIR, path.dirname(DB_PATH)]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Resolve `rel` inside `base`, returning the absolute path only if it stays
 * within `base`. Blocks `..` traversal and absolute-path escapes robustly
 * (via path.relative rather than a prefix check, which is fooled by sibling
 * dirs sharing a name prefix, e.g. `/a/foo` vs `/a/foobar`). Nested subpaths
 * like `dist/index.html` are allowed. Returns null if the path escapes.
 */
export function resolveWithin(base: string, rel: string): string | null {
  const baseAbs = path.resolve(base);
  const full = path.resolve(baseAbs, rel);
  const relToBase = path.relative(baseAbs, full);
  if (relToBase === "" || relToBase.startsWith("..") || path.isAbsolute(relToBase)) {
    return null;
  }
  return full;
}