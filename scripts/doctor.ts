import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Dev-runtime doctor: diagnoses the recurring *environmental* failure classes
 * that look like app bugs — stale/incomplete `.next` chunk caches, hung dev
 * servers on port 3000, `better-sqlite3` ABI mismatches after Node switches,
 * and a corrupt local eval database.
 *
 * Everything here is diagnosis-only. The single mutating action is clearing
 * `.next` (a regenerable build cache), and only when `--fix` is passed. The
 * `data/eval.db` integrity check runs `PRAGMA quick_check` without ever
 * creating or writing files in `data/`: a quiescent database is copied to a
 * temp dir and checked there (a plain readonly open of a WAL-mode SQLite file
 * would otherwise create `-shm`/`-wal` sidecars next to it), and an in-use
 * database (sidecars already present) is opened readonly in place, which
 * creates nothing new. The port-3000 check is report-only — it never kills
 * anything.
 */

export type CheckStatus = "ok" | "info" | "warn" | "fail" | "skip";

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
}

/**
 * A finished `.next` cache always contains a build manifest — `next dev` and
 * `next build` both write these. BUILD_ID alone (prod-only, written late) is
 * NOT proof of completeness, so it only contributes to the mtime comparison.
 */
const NEXT_COMPLETENESS_MARKERS = ["build-manifest.json", "app-build-manifest.json"];
const NEXT_MTIME_MARKERS = ["BUILD_ID", ...NEXT_COMPLETENESS_MARKERS];

/** Inputs that invalidate a `.next` cache when they change after it was written. */
const NEXT_CACHE_INPUTS = [
  "package-lock.json",
  "package.json",
  "next.config.js",
  "tailwind.config.ts",
  "postcss.config.js",
];

function mtimeOf(file: string): number | null {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/** Node version vs `.nvmrc` (ABI-mismatch early warning) and `engines.node` floor. */
export function checkNodeVersion(
  repoRoot: string,
  currentVersion: string = process.versions.node
): CheckResult {
  const id = "node-version";
  const label = "Node version";
  const currentMajor = Number.parseInt(currentVersion.split(".")[0] ?? "", 10);

  let enginesMin: number | null = null;
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
    ) as { engines?: { node?: string } };
    const m = /(\d+)/.exec(pkg.engines?.node ?? "");
    if (m) enginesMin = Number.parseInt(m[1], 10);
  } catch {
    // No readable package.json — engines floor unknown, fall through to .nvmrc.
  }

  if (enginesMin !== null && currentMajor < enginesMin) {
    return {
      id, label, status: "fail",
      detail: `Node ${currentVersion} is below the required engines floor (>=${enginesMin}).`,
      hint: `Switch to Node ${enginesMin}+ (e.g. \`nvm use\`), then \`npm rebuild better-sqlite3\`.`,
    };
  }

  let nvmrc: string | null = null;
  try {
    nvmrc = fs.readFileSync(path.join(repoRoot, ".nvmrc"), "utf8").trim();
  } catch {
    // No .nvmrc — nothing to compare against.
  }
  if (nvmrc) {
    const pinnedMajor = Number.parseInt(nvmrc.replace(/^v/, "").split(".")[0] ?? "", 10);
    if (Number.isFinite(pinnedMajor) && pinnedMajor !== currentMajor) {
      return {
        id, label, status: "warn",
        detail: `Node ${currentVersion} differs from .nvmrc (${nvmrc}). Native modules built under one major do not load under another.`,
        hint: "Run `nvm use`, or `npm rebuild better-sqlite3` if you intend to stay on this Node.",
      };
    }
  }

  return { id, label, status: "ok", detail: `Node ${currentVersion}${nvmrc ? ` matches .nvmrc (${nvmrc})` : ""}.` };
}

/** Loads the native binding and runs a trivial query against `:memory:`. */
export async function checkBetterSqlite3(): Promise<CheckResult> {
  const id = "better-sqlite3";
  const label = "better-sqlite3 native binding";
  try {
    const mod = await import("better-sqlite3");
    const Database = mod.default;
    const db = new Database(":memory:");
    try {
      db.prepare("select 1 as one").get();
    } finally {
      db.close();
    }
    return { id, label, status: "ok", detail: "Native binding loads and answers queries." };
  } catch (err) {
    return {
      id, label, status: "fail",
      detail: `Failed to load or query better-sqlite3: ${err instanceof Error ? err.message : String(err)}`,
      hint: "Usually an ABI mismatch after a Node switch — run `npm rebuild better-sqlite3` (or a full `npm ci`).",
    };
  }
}

/**
 * Detects a `.next` cache that is incomplete (interrupted build/dev — the
 * classic missing-chunk error source) or stale (cache-shaping inputs like the
 * lockfile or next.config.js changed after the cache was written). With
 * `fix: true` a flagged cache is cleared; `.next` is always safe to delete.
 */
export function checkNextCache(repoRoot: string, opts: { fix?: boolean } = {}): CheckResult {
  const id = "next-cache";
  const label = ".next build cache";
  const nextDir = path.join(repoRoot, ".next");
  if (!fs.existsSync(nextDir)) {
    return { id, label, status: "ok", detail: "No .next cache present (nothing to go stale)." };
  }

  const clear = (): void => fs.rmSync(nextDir, { recursive: true, force: true });
  const hasManifest = NEXT_COMPLETENESS_MARKERS.some((f) =>
    fs.existsSync(path.join(nextDir, f))
  );

  if (!hasManifest) {
    if (opts.fix) {
      clear();
      return { id, label, status: "warn", detail: "Incomplete .next cache (no build manifest) — cleared via --fix." };
    }
    return {
      id, label, status: "warn",
      detail: "Incomplete .next cache: directory exists but has no build manifest (interrupted build or dev start).",
      hint: "Clear it: `rm -rf .next` (or rerun with `npm run doctor -- --fix`), then restart the dev server.",
    };
  }

  const markerTimes = NEXT_MTIME_MARKERS
    .map((f) => mtimeOf(path.join(nextDir, f)))
    .filter((t): t is number => t !== null);
  const cacheTime = Math.max(...markerTimes);
  const staleAgainst = NEXT_CACHE_INPUTS.filter((f) => {
    const t = mtimeOf(path.join(repoRoot, f));
    return t !== null && t > cacheTime;
  });
  if (staleAgainst.length > 0) {
    if (opts.fix) {
      clear();
      return {
        id, label, status: "warn",
        detail: `Stale .next cache (older than ${staleAgainst.join(", ")}) — cleared via --fix.`,
      };
    }
    return {
      id, label, status: "warn",
      detail: `Stale .next cache: ${staleAgainst.join(", ")} changed after the cache was written. This is the usual source of missing-chunk errors and hung dev servers.`,
      hint: "Clear it: `rm -rf .next` (or rerun with `npm run doctor -- --fix`), then restart the dev server.",
    };
  }

  return { id, label, status: "ok", detail: ".next cache is complete and newer than its config inputs." };
}

/** Report-only: who is listening on the dev port. Never kills anything. */
export function checkPort3000(port = 3000): CheckResult {
  const id = "port-3000";
  const label = `Port ${port}`;
  const res = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
  if (res.error) {
    return { id, label, status: "skip", detail: "lsof is not available; port occupancy not checked." };
  }
  const lines = (res.stdout ?? "").trim().split("\n").filter(Boolean);
  if (res.status === 0 && lines.length > 1) {
    const listeners = lines
      .slice(1)
      .map((l) => {
        const cols = l.split(/\s+/);
        return `${cols[0]} (pid ${cols[1]})`;
      })
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .join(", ");
    return {
      id, label, status: "info",
      detail: `Occupied by ${listeners}. Fine if that is your dev server; a forgotten process here causes silent port fallback.`,
    };
  }
  return { id, label, status: "ok", detail: `Port ${port} is free.` };
}

/**
 * Read-only integrity probe of the eval database (`PRAGMA quick_check`).
 *
 * The real eval.db runs in WAL mode (lib/db.ts), and even a
 * `readonly: true` SQLite open of a WAL database creates `-shm`/`-wal`
 * sidecar files next to it — which would violate the "never touch operator
 * data/" contract. So:
 *  - quiescent database (no sidecars): copy the file (+ any wal) to a temp
 *    dir and quick_check the copy there; nothing is ever created in data/.
 *  - in-use database (both sidecars already present, e.g. a running dev
 *    server): open readonly in place — the sidecars already exist, so the
 *    open creates nothing new, and a readonly connection cannot checkpoint
 *    or delete them.
 */
export async function checkDatabase(dbPath: string): Promise<CheckResult> {
  const id = "eval-db";
  const label = "data/ eval database";
  if (!fs.existsSync(dbPath)) {
    return { id, label, status: "skip", detail: `No database at ${dbPath} yet (created on first run).` };
  }

  const walPath = `${dbPath}-wal`;
  const inPlace = fs.existsSync(walPath) && fs.existsSync(`${dbPath}-shm`);
  let tempDir: string | null = null;
  try {
    const mod = await import("better-sqlite3");
    const Database = mod.default;

    let target = dbPath;
    if (!inPlace) {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-doctor-"));
      target = path.join(tempDir, path.basename(dbPath));
      fs.copyFileSync(dbPath, target);
      if (fs.existsSync(walPath)) fs.copyFileSync(walPath, `${target}-wal`);
    }

    const db = new Database(target, { readonly: true, fileMustExist: true });
    try {
      db.pragma("busy_timeout = 3000");
      const rows = db.pragma("quick_check") as Array<{ quick_check?: string } | string>;
      const first = rows[0];
      const verdict = typeof first === "string" ? first : first?.quick_check;
      if (verdict === "ok") {
        return {
          id, label, status: "ok",
          detail: `quick_check ok (${dbPath}${inPlace ? ", checked in place while in use" : ", checked on a temp copy"}).`,
        };
      }
      if (!inPlace && fs.existsSync(walPath)) {
        // The snapshot could have been torn by a writer that appeared
        // mid-copy — do not scream corruption from a maybe-torn copy.
        return {
          id, label, status: "warn",
          detail: `quick_check reported problems on a temp copy taken while the database became active; rerun \`npm run doctor\` when the dev server is idle to confirm.`,
        };
      }
      return {
        id, label, status: "fail",
        detail: `quick_check reported problems: ${JSON.stringify(rows).slice(0, 300)}`,
        hint: "Back up data/ before doing anything else; the database may be corrupt.",
      };
    } finally {
      db.close();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(message)) {
      return { id, label, status: "warn", detail: `Database is busy/locked (${message}); integrity not verified this pass.` };
    }
    return {
      id, label, status: "fail",
      detail: `Could not read the database read-only: ${message}`,
      hint: "The file may be corrupt or not a SQLite database. Back up data/ before touching it.",
    };
  } finally {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/** Free-space report for the volume holding `root`. Warns under 2 GiB. */
export function checkDiskHeadroom(root: string): CheckResult {
  const id = "disk";
  const label = "Disk headroom";
  try {
    const st = fs.statfsSync(root);
    const freeBytes = Number(st.bavail) * Number(st.bsize);
    const freeGiB = freeBytes / 1024 ** 3;
    const detail = `${freeGiB.toFixed(1)} GiB free on the volume holding ${root}.`;
    if (freeGiB < 2) {
      return {
        id, label, status: "warn", detail,
        hint: "Under 2 GiB: builds, workdirs, and SQLite WAL growth can fail in confusing ways.",
      };
    }
    return { id, label, status: "ok", detail };
  } catch (err) {
    return { id, label, status: "skip", detail: `Could not stat the filesystem: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export interface DoctorOptions {
  repoRoot?: string;
  /** Directory containing `data/eval.db`; defaults to OPENEVAL_DATA_ROOT or repoRoot. */
  dataRoot?: string;
  fix?: boolean;
  port?: number;
}

export async function runDoctor(opts: DoctorOptions = {}): Promise<{ results: CheckResult[]; exitCode: number }> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const dataRoot = path.resolve(
    opts.dataRoot ??
      (process.env.OPENEVAL_DATA_ROOT
        ? path.resolve(repoRoot, process.env.OPENEVAL_DATA_ROOT)
        : repoRoot)
  );
  const results: CheckResult[] = [
    checkNodeVersion(repoRoot),
    await checkBetterSqlite3(),
    checkNextCache(repoRoot, { fix: opts.fix }),
    checkPort3000(opts.port ?? 3000),
    await checkDatabase(path.join(dataRoot, "data", "eval.db")),
    checkDiskHeadroom(repoRoot),
  ];
  return { results, exitCode: results.some((r) => r.status === "fail") ? 1 : 0 };
}

const STATUS_TAG: Record<CheckStatus, string> = {
  ok: "[ OK ]",
  info: "[INFO]",
  warn: "[WARN]",
  fail: "[FAIL]",
  skip: "[SKIP]",
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fix = args.includes("--fix");
  const json = args.includes("--json");
  const { results, exitCode } = await runDoctor({ fix });

  if (json) {
    console.log(JSON.stringify({ ok: exitCode === 0, results }, null, 2));
  } else {
    console.log("OpenEval doctor — dev-runtime health\n");
    for (const r of results) {
      console.log(`${STATUS_TAG[r.status]} ${r.label}: ${r.detail}`);
      if (r.hint) console.log(`       hint: ${r.hint}`);
    }
    const warns = results.filter((r) => r.status === "warn").length;
    console.log(
      exitCode === 0
        ? `\nHealthy${warns ? ` (${warns} warning${warns === 1 ? "" : "s"} above)` : ""}.`
        : "\nProblems found — see [FAIL] lines above."
    );
  }
  process.exitCode = exitCode;
}

// Run only when invoked directly (`tsx scripts/doctor.ts`), not when the
// checks are imported by tests.
if (process.argv[1]?.endsWith("doctor.ts")) {
  void main();
}
