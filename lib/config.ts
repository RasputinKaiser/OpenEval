import path from "node:path";
import fs from "node:fs";

export const ROOT = path.resolve(process.cwd());
export const DB_PATH = path.join(ROOT, "data", "eval.db");
export const CASES_DIR = path.join(ROOT, "cases");
export const FIXTURES_DIR = path.join(ROOT, "fixtures");
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