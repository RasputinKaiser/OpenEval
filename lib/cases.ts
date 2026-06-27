import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";
import { CASES_DIR } from "./config";
import { z } from "zod";
import type { CaseDefinition, Category } from "./types";

const CaseSchema = z.object({
  id: z.string(),
  category: z.enum(["agentic-swe", "single-tool", "reasoning"]),
  name: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  prompt: z.string(),
  setup: z.object({
    type: z.enum(["none", "fixture", "git-clone"]),
    fixture: z.string().optional(),
    repo: z.string().optional(),
    workdir_name: z.string().optional(),
  }).optional(),
  runner: z.object({
    max_turns: z.number().optional(),
    timeout_seconds: z.number().optional(),
    permission_mode: z.enum(["bypassPermissions", "default", "acceptEdits", "dontAsk", "plan", "auto"]).optional(),
    model: z.string().optional(),
    extra_args: z.array(z.string()).optional(),
  }).optional(),
  graders: z.array(z.any()).nonempty(),
  pass_threshold: z.number().optional(),
});

let cache: CaseDefinition[] | null = null;

export async function loadCases(opts: { force?: boolean } = {}): Promise<CaseDefinition[]> {
  if (cache && !opts.force) return cache;
  const out: CaseDefinition[] = [];
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(CASES_DIR, { withFileTypes: true });
  } catch { cache = out; return out; }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const catDir = path.join(CASES_DIR, ent.name);
    if (!["agentic-swe", "single-tool", "reasoning"].includes(ent.name)) continue;
    const files = await fs.readdir(catDir);
    for (const f of files) {
      if (!f.endsWith(".case.json")) continue;
      const full = path.join(catDir, f);
      const text = await fs.readFile(full, "utf8");
      const parsed = CaseSchema.parse(JSON.parse(text));
      out.push(parsed as CaseDefinition);
    }
  }
  cache = out.sort((a, b) => a.id.localeCompare(b.id));
  return cache;
}

export async function getCase(id: string): Promise<CaseDefinition | null> {
  const all = await loadCases();
  return all.find((c) => c.id === id) ?? null;
}

export interface CaseFilter {
  caseIds?: string[];
  categories?: string[];
  tags?: string[];
}

export async function selectCases(filter: CaseFilter): Promise<CaseDefinition[]> {
  const all = await loadCases();
  return all.filter((c) => {
    if (filter.caseIds && filter.caseIds.length && !filter.caseIds.includes(c.id)) return false;
    if (filter.categories && filter.categories.length && !filter.categories.includes(c.category)) return false;
    if (filter.tags && filter.tags.length && !filter.tags.some((t) => c.tags?.includes(t))) return false;
    return true;
  });
}