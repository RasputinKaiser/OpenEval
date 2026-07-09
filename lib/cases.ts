import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";
import { CASES_DIR } from "./config";
import { z } from "zod";
import type { CaseDefinition } from "./types";

export const CASE_CATEGORIES = ["agentic-swe", "single-tool", "reasoning", "visual-code"] as const;

const CATEGORIES = new Set<string>(CASE_CATEGORIES);

const GraderSpecSchema = z.intersection(
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("exit_code"),
      command: z.string(),
      cwd: z.string().optional(),
      env: z.record(z.string()).optional(),
      timeout_ms: z.number().optional(),
      weight: z.number().optional(),
    }),
    z.object({
      type: z.literal("tests_pass"),
      command: z.string(),
      cwd: z.string().optional(),
      env: z.record(z.string()).optional(),
      timeout_ms: z.number().optional(),
      weight: z.number().optional(),
    }),
    z.object({
      type: z.literal("file_contains"),
      path: z.string(),
      pattern: z.string(),
      negate: z.boolean().optional(),
      weight: z.number().optional(),
    }),
    z.object({
      type: z.literal("file_exists"),
      path: z.string(),
      negate: z.boolean().optional(),
      weight: z.number().optional(),
    }),
    z.object({
      type: z.literal("file_eq"),
      path: z.string(),
      expected: z.string(),
      trim: z.boolean().optional(),
      weight: z.number().optional(),
    }),
    z.object({
      type: z.literal("regex_match"),
      pattern: z.string(),
      source: z.enum(["stdout", "final_text", "transcript"]).optional(),
      negate: z.boolean().optional(),
      weight: z.number().optional(),
    }),
    z.object({
      type: z.literal("json_path"),
      path: z.string(),
      jsonpath: z.string(),
      equals: z.unknown(),
      weight: z.number().optional(),
    }),
    z.object({
      type: z.literal("files_unchanged"),
      paths: z.array(z.string()),
      fixture: z.string().optional(),
      weight: z.number().optional(),
    }),
    z.object({
      type: z.literal("file_deleted"),
      path: z.string(),
      weight: z.number().optional(),
    }),
    z.object({
      type: z.literal("git_diff_contains"),
      pattern: z.string(),
      negate: z.boolean().optional(),
      pathFilter: z.string().optional(),
      weight: z.number().optional(),
    }),
    z.object({
      type: z.literal("checksum"),
      path: z.string(),
      algorithm: z.enum(["sha256", "md5"]).optional(),
      expected: z.string(),
      weight: z.number().optional(),
    }),
    z.object({
      type: z.literal("step"),
      tool: z.string().optional(),
      input_includes: z.string().optional(),
      input_includes_any: z.array(z.string()).optional(),
      at_index: z.number().optional(),
      min_count: z.number().optional(),
      before_tool: z.string().optional(),
      negate: z.boolean().optional(),
      weight: z.number().optional(),
    }),
    z.object({
      type: z.literal("rubric_llm"),
      rubric: z.string(),
      min_score: z.number().optional(),
      model: z.string().optional(),
      judge_harness: z.string().optional(),
      judge_model: z.string().optional(),
      weight: z.number().optional(),
    }),
    z.object({
      type: z.literal("manual"),
      note: z.string().optional(),
      weight: z.number().optional(),
    }),
  ]),
  z.object({ forbidden: z.boolean().optional() })
);

const SetupSchema = z
  .object({
    type: z.enum(["none", "fixture", "git-clone"]),
    fixture: z.string().optional(),
    repo: z.string().optional(),
    workdir_name: z.string().optional(),
    init_git: z.boolean().optional(),
  })
  .refine((s) => s.type !== "git-clone" || s.repo !== undefined, {
    message: "repo is required when type is git-clone",
    path: ["repo"],
  });
const VisualSchema = z.object({
  kind: z.enum(["svg", "threejs", "web_ui", "app_ui", "screenshot"]),
  requires_vision_input: z.boolean().optional(),
  expected_artifacts: z.array(z.string()).optional(),
});

export const CaseDefinitionSchema = z.object({
  id: z.string().min(1),
  category: z.enum(CASE_CATEGORIES),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  name: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  split: z.enum(["public", "held_out"]).optional(),
  canary: z.string().optional(),
  prompt: z.string(),
  setup: SetupSchema.optional(),
  runner: z.object({
    max_turns: z.number().optional(),
    timeout_seconds: z.number().optional(),
    permission_mode: z.enum(["bypassPermissions", "default", "acceptEdits", "dontAsk", "plan", "auto"]).optional(),
    model: z.string().optional(),
    extra_args: z.array(z.string()).optional(),
  }).optional(),
  budget: z.object({
    max_cost_usd: z.number().optional(),
    max_turns: z.number().optional(),
  }).optional(),
  oracle: z.object({
    solve: z.string().optional(),
    final_text: z.string().optional(),
    noop_max_score: z.number().optional(),
    known_bad: z.array(z.string()).optional(),
  }).optional(),
  visual: VisualSchema.optional(),
  graders: z.array(GraderSpecSchema).min(1),
  pass_threshold: z.number().optional(),
});

export type ZodCaseDefinition = z.infer<typeof CaseDefinitionSchema>;

export interface CaseLoadError {
  file: string;
  paths: string[];
}

function formatZodPath(path: Array<string | number>): string {
  if (path.length === 0) return "(root)";
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") out += `[${segment}]`;
    else if (out === "") out = segment;
    else out += `.${segment}`;
  }
  return out;
}

export function formatCaseLoadErrors(errors: CaseLoadError[]): string[] {
  return errors.flatMap((e) => e.paths.map((p) => `${e.file}: ${p}`));
}

let casesWithErrorsCache: { cases: CaseDefinition[]; errors: CaseLoadError[] } | null = null;
export async function loadCasesWithErrors(
  opts: { force?: boolean } = {}
): Promise<{ cases: CaseDefinition[]; errors: CaseLoadError[] }> {
  if (casesWithErrorsCache && !opts.force) return casesWithErrorsCache;
  const cases: CaseDefinition[] = [];
  const errors: CaseLoadError[] = [];
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(CASES_DIR, { withFileTypes: true });
  } catch {
    casesWithErrorsCache = { cases, errors };
    return casesWithErrorsCache;
  }
  const categorySet = CATEGORIES;
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (!categorySet.has(ent.name)) continue;
    const catDir = path.join(CASES_DIR, ent.name);
    let files: string[] = [];
    try {
      files = await fs.readdir(catDir);
    } catch {
      // An unreadable category subdir should skip that category, not abort the
      // whole load (which would leave the cache unset and re-throw every call).
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".case.json")) continue;
      const full = path.join(catDir, f);
      const relative = path.relative(CASES_DIR, full);
      let parsedJson: unknown;
      try {
        const text = await fs.readFile(full, "utf8");
        parsedJson = JSON.parse(text);
      } catch {
        errors.push({ file: relative, paths: ["(invalid JSON)"] });
        continue;
      }
      const result = CaseDefinitionSchema.safeParse(parsedJson);
      if (result.success) {
        cases.push(result.data as CaseDefinition);
      } else {
        const issuePaths = result.error.issues.map((issue) => formatZodPath(issue.path));
        errors.push({ file: relative, paths: [...new Set(issuePaths)] });
      }
    }
  }
  cases.sort((a, b) => a.id.localeCompare(b.id));
  casesWithErrorsCache = { cases, errors };
  return casesWithErrorsCache;
}
export async function loadCases(
  opts: { force?: boolean } = {}
): Promise<CaseDefinition[]> {
  if (casesWithErrorsCache && !opts.force) return casesWithErrorsCache.cases;
  const { cases } = await loadCasesWithErrors(opts);
  return cases;
}

export async function loadCasesStrict(
  opts: { force?: boolean } = {}
): Promise<CaseDefinition[]> {
  const { cases, errors } = await loadCasesWithErrors(opts);
  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(
      `Validation failed for ${first.file}: ${first.paths.join(", ")}`
    );
  }
  return cases;
}

export async function getCase(id: string): Promise<CaseDefinition | null> {
  const all = await loadCases();
  return all.find((c) => c.id === id) ?? null;
}

export interface CaseFilter {
  caseIds?: string[];
  categories?: string[];
  tags?: string[];
  difficulty?: string[];
}

export async function selectCases(filter: CaseFilter): Promise<CaseDefinition[]> {
  const all = await loadCases();
  return all.filter((c) => {
    if (filter.caseIds && filter.caseIds.length && !filter.caseIds.includes(c.id)) return false;
    if (filter.categories && filter.categories.length && !filter.categories.includes(c.category)) return false;
    if (filter.tags && filter.tags.length && !filter.tags.some((t) => c.tags?.includes(t))) return false;
    if (filter.difficulty && filter.difficulty.length && (!c.difficulty || !filter.difficulty.includes(c.difficulty))) return false;
    return true;
  });
}
