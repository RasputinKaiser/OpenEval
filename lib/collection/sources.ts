import os from "node:os";
import path from "node:path";
import { listAdapters } from "../adapters/registry";
import type { CollectionSourceSpec, LiveTraceFormat } from "../live";
import type { FieldMapping } from "../adapters/generic";

/**
 * A known place agent transcripts live on disk. This is deliberately decoupled
 * from runnable harness adapters: you may have Cursor or Cline transcripts on
 * this machine without OpenEval being able to *run* those tools.
 *
 * `parseable: false` means "we can detect the files but don't yet have a parser
 * for their format" (JSON arrays, SQLite, markdown). Discovery still reports
 * their presence and counts — it just never emits (potentially wrong) metrics
 * for them. Accuracy over breadth.
 */
export interface CollectionSourceDef {
  id: string;
  label: string;
  roots: string[]; // may use ~; platform variants are fine (absent roots are ignored)
  format: LiveTraceFormat;
  fields?: FieldMapping;
  inferredModel?: string;
  parseable: boolean;
  /** File extensions to count for detect-only sources (parseable === false). */
  detectExts?: string[];
  note?: string;
}

/**
 * Curated catalog of known collection-only harnesses (not runnable here).
 * This is DATA — adding a harness is a new entry, not new code. Paths are
 * best-effort defaults; a root that doesn't exist is simply reported absent.
 */
export const KNOWN_COLLECTION_SOURCES: CollectionSourceDef[] = [
  {
    id: "goose",
    label: "Goose",
    roots: ["~/.local/share/goose/sessions"],
    format: "jsonl-dir",
    parseable: true,
    note: "Block Goose CLI JSONL sessions (best-effort field inference).",
  },
  {
    id: "opencode",
    label: "opencode",
    roots: ["~/.local/share/opencode"],
    format: "jsonl-dir",
    parseable: false,
    detectExts: [".json", ".jsonl"],
    note: "opencode stores per-message JSON; detect-only until a parser lands.",
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    roots: ["~/.gemini/tmp", "~/.gemini"],
    format: "jsonl-dir",
    parseable: false,
    detectExts: [".json", ".jsonl"],
    note: "Gemini CLI checkpoints/logs; detect-only.",
  },
  {
    id: "continue",
    label: "Continue",
    roots: ["~/.continue/sessions"],
    format: "jsonl-dir",
    parseable: false,
    detectExts: [".json"],
    note: "Continue session JSON; detect-only.",
  },
  {
    id: "cline",
    label: "Cline",
    roots: [
      "~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/tasks",
      "~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/tasks",
      "~/AppData/Roaming/Code/User/globalStorage/saoudrizwan.claude-dev/tasks",
    ],
    format: "jsonl-dir",
    parseable: false,
    detectExts: [".json"],
    note: "Cline VS Code task history (api_conversation_history.json); detect-only.",
  },
  {
    id: "cursor",
    label: "Cursor",
    roots: [
      "~/Library/Application Support/Cursor/User/globalStorage",
      "~/.config/Cursor/User/globalStorage",
      "~/AppData/Roaming/Cursor/User/globalStorage",
    ],
    format: "jsonl-dir",
    parseable: false,
    detectExts: [".vscdb", ".sqlite"],
    note: "Cursor stores chats in a SQLite state DB; detect-only.",
  },
];

/** Runnable harnesses that declare a liveTrace also contribute a source. */
export function collectionSourcesFromAdapters(): CollectionSourceDef[] {
  const out: CollectionSourceDef[] = [];
  for (const adapter of listAdapters()) {
    const lt = adapter.descriptor.liveTrace;
    if (!lt) continue;
    out.push({
      id: adapter.id,
      label: adapter.label,
      roots: lt.roots,
      format: (lt.format ?? "jsonl-dir") as LiveTraceFormat,
      fields: lt.fields ?? (lt.format === "jsonl-dir" || !lt.format ? adapter.descriptor.fields : undefined),
      inferredModel: lt.inferredModel,
      parseable: true,
    });
  }
  return out;
}

/**
 * All known collection sources: runnable-harness liveTraces first (authoritative
 * — they carry exact field mappings), then curated collection-only entries whose
 * first root isn't already claimed by an adapter.
 */
export function allCollectionSources(): CollectionSourceDef[] {
  const adapters = collectionSourcesFromAdapters();
  const claimed = new Set(adapters.flatMap((s) => s.roots.map((r) => r.replace(/\/+$/, ""))));
  const extras = KNOWN_COLLECTION_SOURCES.filter(
    (s) => !s.roots.some((r) => claimed.has(r.replace(/\/+$/, ""))),
  );
  return [...adapters, ...extras];
}

/**
 * Is this absolute path inside any known collection source's root? The
 * transcript viewer takes a file path from the URL — without this check it
 * would read arbitrary files.
 */
export function isPathInAnyCollectionSource(filePath: string): boolean {
  const home = os.homedir();
  const expand = (r: string) => (r === "~" ? home : r.startsWith("~/") ? path.join(home, r.slice(2)) : r);
  const resolved = path.resolve(filePath);
  for (const def of allCollectionSources()) {
    for (const root of def.roots) {
      const base = path.resolve(expand(root));
      const rel = path.relative(base, resolved);
      if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return true;
    }
  }
  return false;
}

/** Convert a def into the spec that live.ts's scanner consumes (parseable only). */
export function defToSpec(def: CollectionSourceDef): CollectionSourceSpec {
  return {
    id: def.id,
    label: def.label,
    roots: def.roots,
    format: def.format,
    fields: def.fields,
    inferredModel: def.inferredModel,
  };
}
