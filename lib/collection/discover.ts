import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listSourceFiles } from "../live";
import { allCollectionSources, defToSpec, type CollectionSourceDef } from "./sources";

export interface DiscoveredSource {
  id: string;
  label: string;
  format: string;
  parseable: boolean;
  roots: string[];
  presentRoots: string[];
  sessionCount: number;
  lastActivityMs: number | null;
  status: "present" | "empty" | "absent";
  note?: string;
}

export interface UnknownCandidate {
  dir: string;
  displayDir: string;
  sampleFile: string;
  fileCount: number;
  reason: string;
}

export interface DiscoveryReport {
  known: DiscoveredSource[];
  unknown: UnknownCandidate[];
  scannedAt: number | null; // stamped by caller (Date.* is unavailable in some contexts)
  totalKnownSessions: number;
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

const NOISE_DIRS = new Set([
  "node_modules", ".git", ".Trash", "Caches", "Cache", "CachedData",
  "logs", "tmp_cache", ".cache", "Code Cache", "GPUCache",
]);

/** Cheap recursive count of files with the given extensions, bounded. */
function countFilesByExt(root: string, exts: string[], maxDepth = 4, cap = 5000): { count: number; lastMs: number | null; sample: string | null } {
  let count = 0;
  let lastMs: number | null = null;
  let sample: string | null = null;
  const walk = (dir: string, depth: number) => {
    if (depth < 0 || count >= cap) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (count >= cap) return;
      if (ent.isDirectory()) {
        if (NOISE_DIRS.has(ent.name)) continue;
        walk(path.join(dir, ent.name), depth - 1);
      } else if (ent.isFile() && exts.some((e) => ent.name.endsWith(e))) {
        const full = path.join(dir, ent.name);
        count++;
        if (!sample) sample = full;
        try {
          const m = fs.statSync(full).mtimeMs;
          if (lastMs == null || m > lastMs) lastMs = m;
        } catch {}
      }
    }
  };
  walk(root, maxDepth);
  return { count, lastMs, sample };
}

export function discoverKnownSources(): DiscoveredSource[] {
  const out: DiscoveredSource[] = [];
  for (const def of allCollectionSources()) {
    const roots = def.roots.map(expandHome);
    const presentRoots: string[] = [];
    let sessionCount = 0;
    let lastActivityMs: number | null = null;

    if (def.parseable) {
      const files = listSourceFiles(defToSpec(def));
      sessionCount = files.length;
      for (const f of files) {
        if (lastActivityMs == null || f.mtime > lastActivityMs) lastActivityMs = f.mtime;
      }
      for (const r of roots) {
        try { if (fs.existsSync(r)) presentRoots.push(r); } catch {}
      }
    } else {
      const exts = def.detectExts ?? [".json", ".jsonl"];
      for (const r of roots) {
        let exists = false;
        try { exists = fs.existsSync(r); } catch {}
        if (!exists) continue;
        presentRoots.push(r);
        const { count, lastMs } = countFilesByExt(r, exts);
        sessionCount += count;
        if (lastMs != null && (lastActivityMs == null || lastMs > lastActivityMs)) lastActivityMs = lastMs;
      }
    }

    const status: DiscoveredSource["status"] =
      presentRoots.length === 0 ? "absent" : sessionCount === 0 ? "empty" : "present";

    out.push({
      id: def.id, label: def.label, format: def.format, parseable: def.parseable,
      roots, presentRoots, sessionCount, lastActivityMs, status, note: def.note,
    });
  }
  return out;
}

/** Does a JSONL file's first few lines look like an agent transcript? */
export function looksLikeTranscriptFile(file: string): boolean {
  let raw: string;
  try { raw = fs.readFileSync(file, "utf8"); } catch { return false; }
  const lines = raw.split("\n").filter((l) => l.trim()).slice(0, 8);
  if (lines.length === 0) return false;
  let hits = 0;
  for (const line of lines) {
    let obj: any;
    try { obj = JSON.parse(line); } catch { continue; }
    if (!obj || typeof obj !== "object") continue;
    const keys = new Set(Object.keys(obj));
    const role = String(obj.role ?? obj.type ?? obj.message?.role ?? "").toLowerCase();
    const hasRole = ["assistant", "user", "system", "tool"].some((r) => role.includes(r));
    const hasToolShape = keys.has("tool_use") || keys.has("tool_calls") || keys.has("function_call") ||
      obj.type === "function_call" || obj.type === "tool_use" || obj.type === "response_item";
    const hasMsg = keys.has("message") || keys.has("content") || keys.has("text");
    if ((hasRole && hasMsg) || hasToolShape) hits++;
  }
  return hits >= Math.max(1, Math.floor(lines.length / 2));
}

/**
 * Bounded, read-only scan of a small allow-list of parent dirs for *unknown*
 * transcript-like sources (JSONL that looks like an agent trace) not already
 * covered by a known source. Returns candidates only — never parsed into
 * metrics, so it can't corrupt the accurate data.
 */
export function discoverUnknownCandidates(knownRoots: string[], opts?: { maxDepth?: number; maxDirs?: number; maxCandidates?: number }): UnknownCandidate[] {
  const home = os.homedir();
  const maxDepth = opts?.maxDepth ?? 4;
  const maxDirs = opts?.maxDirs ?? 6000;
  const maxCandidates = opts?.maxCandidates ?? 40;

  const known = knownRoots.map((r) => path.resolve(r));
  const isUnderKnown = (dir: string) => {
    const abs = path.resolve(dir);
    return known.some((k) => abs === k || abs.startsWith(k + path.sep));
  };

  const parents = [
    path.join(home, ".config"),
    path.join(home, ".local", "share"),
    path.join(home, "Library", "Application Support"),
    ...(() => {
      // one level of home dotdirs (e.g. ~/.aider, ~/.foo-agent)
      try {
        return fs.readdirSync(home, { withFileTypes: true })
          .filter((d) => d.isDirectory() && d.name.startsWith("."))
          .map((d) => path.join(home, d.name));
      } catch { return []; }
    })(),
  ];

  const candidates: UnknownCandidate[] = [];
  const seenDirs = new Set<string>();
  let dirsVisited = 0;

  const walk = (dir: string, depth: number) => {
    if (depth < 0 || dirsVisited >= maxDirs || candidates.length >= maxCandidates) return;
    if (seenDirs.has(dir)) return;
    seenDirs.add(dir);
    dirsVisited++;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

    const jsonlHere = entries.filter((e) => e.isFile() && e.name.endsWith(".jsonl"));
    if (jsonlHere.length > 0 && !isUnderKnown(dir)) {
      const sample = path.join(dir, jsonlHere[0].name);
      if (looksLikeTranscriptFile(sample)) {
        candidates.push({
          dir,
          displayDir: dir.startsWith(home) ? "~" + dir.slice(home.length) : dir,
          sampleFile: sample,
          fileCount: jsonlHere.length,
          reason: "JSONL files whose first lines look like an agent transcript",
        });
        return; // don't descend further into a matched source dir
      }
    }
    for (const ent of entries) {
      if (!ent.isDirectory() || NOISE_DIRS.has(ent.name)) continue;
      walk(path.join(dir, ent.name), depth - 1);
    }
  };

  for (const p of parents) {
    try { if (fs.existsSync(p)) walk(p, maxDepth); } catch {}
  }
  return candidates;
}

export function discoverAll(): DiscoveryReport {
  const known = discoverKnownSources();
  const knownRoots = known.flatMap((s) => s.roots);
  const unknown = discoverUnknownCandidates(knownRoots);
  return {
    known,
    unknown,
    scannedAt: null,
    totalKnownSessions: known.reduce((a, s) => a + s.sessionCount, 0),
  };
}
