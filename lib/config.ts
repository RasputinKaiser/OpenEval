import path from "node:path";
import fs from "node:fs";

export const ROOT = path.resolve(process.cwd());
export const DB_PATH = path.join(ROOT, "data", "eval.db");
export const CASES_DIR = path.join(ROOT, "cases");
export const FIXTURES_DIR = path.join(ROOT, "fixtures");
export const WORKDIRS_DIR = path.join(ROOT, "data", "workdirs");
export const TRANSCRIPTS_DIR = path.join(ROOT, "data", "transcripts");

export const NCODE_BIN = process.env.NCODE_BIN || "ncode";

export function ensureDirs() {
  for (const dir of [WORKDIRS_DIR, TRANSCRIPTS_DIR, path.dirname(DB_PATH)]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}