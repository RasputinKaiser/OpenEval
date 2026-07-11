import { z } from "zod";

/**
 * Harness descriptor schema.
 *
 * A descriptor is the single way a harness is defined in OpenEval — the
 * bundled adapters (Claude Code, Codex, ncode) are descriptors too, they just
 * ship inside the repo. Anything expressible here needs zero code.
 */

export const PERMISSION_MODES = [
  "bypassPermissions",
  "default",
  "acceptEdits",
  "dontAsk",
  "plan",
  "auto",
] as const;

export const PARSERS = ["claude-stream-json", "codex-jsonl", "generic-jsonl", "text"] as const;
export type ParserKind = (typeof PARSERS)[number];

const FieldMappingSchema = z
  .object({
    finalText: z.string().optional(),
    sessionId: z.string().optional(),
    model: z.string().optional(),
    toolCallName: z.string().optional(),
    toolCallId: z.string().optional(),
    toolCallInput: z.string().optional(),
    toolCallOutput: z.string().optional(),
    toolCallError: z.string().optional(),
    durationMs: z.string().optional(),
    numTurns: z.string().optional(),
    costUsd: z.string().optional(),
    inputTokens: z.string().optional(),
    outputTokens: z.string().optional(),
    cacheReadTokens: z.string().optional(),
    cacheCreateTokens: z.string().optional(),
    stopReason: z.string().optional(),
    isError: z.string().optional(),
  })
  .strict();

const LiveTraceSchema = z
  .object({
    /** Session-file layout. "claude-projects" = ~/.claude/projects-style JSONL trees. */
    format: z.enum(["claude-projects", "codex-sessions", "jsonl-dir", "hermes-json"]).default("jsonl-dir"),
    roots: z.array(z.string()).min(1),
    maxDepth: z.number().int().positive().optional(),
    fields: FieldMappingSchema.optional(),
    /** Model to report (as "inferred") when a trace does not record one. */
    inferredModel: z.string().optional(),
  })
  .strict();

const ModelAliasSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    family: z.string().min(1),
  })
  .strict();

const ModelsSchema = z
  .object({
    /** Static model list always offered for this harness. */
    aliases: z.array(ModelAliasSchema).optional(),
    /** Optional default model when a run doesn't specify one. */
    default: z.string().optional(),
    /**
     * Optional discovery of previously-used models from a local config file.
     * `jsonPath` points at an object whose keys are model ids (dot path,
     * `*` wildcard segments allowed).
     */
    discovery: z
      .object({
        file: z.string().min(1),
        jsonPath: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

const PromptSchema = z
  .object({
    mode: z.enum(["arg", "flag", "stdin", "template"]),
    flag: z.string().optional(),
  })
  .strict();

const CapabilitiesSchema = z
  .object({
    reportsCost: z.boolean().optional(),
    reportsTokens: z.boolean().optional(),
    reportsTurns: z.boolean().optional(),
    supportsVisionInput: z.boolean().optional(),
    permissionModes: z.array(z.enum(PERMISSION_MODES)).optional(),
  })
  .strict();

export const HarnessDescriptorSchema = z
  .object({
    id: z.string().min(1).regex(/^[a-z0-9][a-z0-9._-]*$/i, "id must be alphanumeric with . _ -"),
    label: z.string().min(1),
    binNames: z.array(z.string().min(1)).min(1),
    defaultBin: z.string().optional(),
    /** Env var that overrides the binary path (e.g. "CLAUDE_BIN"). */
    binEnvVar: z.string().optional(),
    wellKnownPaths: z.array(z.string()).optional(),
    versionArgs: z.array(z.string()).optional(),

    /** Which stdout parser to use. Falls back from legacy `output` when omitted. */
    parser: z.enum(PARSERS).optional(),
    /** Legacy output-format field; kept for back-compat with existing descriptors. */
    output: z.enum(["jsonl", "stream-json", "text", "json"]).optional(),

    argTemplate: z.array(z.string()),
    extraEnv: z.record(z.string()).optional(),

    /** How the prompt reaches the harness. Defaults: {prompt} in argTemplate → template; promptPlaceholder → flag; else trailing arg. */
    prompt: PromptSchema.optional(),
    /** Legacy alias for prompt: { mode: "flag", flag: ... }. */
    promptPlaceholder: z.string().optional(),

    workdirFlag: z.string().optional(),
    modelFlag: z.string().optional(),
    maxTurnsFlag: z.string().optional(),
    /** Simple form: `<permissionFlag> <mode>` is appended. */
    permissionFlag: z.string().optional(),
    /** Full form: per-mode argument lists; "*" is the fallback entry. */
    permissionArgs: z.record(z.array(z.string())).optional(),
    /** Append the case's extra_args to the command line (default true). */
    appendExtraArgs: z.boolean().optional(),

    eventFilter: z.string().optional(),
    fields: FieldMappingSchema.optional(),
    capabilities: CapabilitiesSchema.optional(),
    liveTrace: LiveTraceSchema.optional(),
    models: ModelsSchema.optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    const parser = d.parser ?? legacyOutputToParser(d.output);
    if (!parser) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "one of `parser` or `output` is required" });
    }
    if (parser === "generic-jsonl" && !d.fields) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "`fields` is required when parser is generic-jsonl" });
    }
    if (d.prompt?.mode === "flag" && !d.prompt.flag) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "prompt.flag is required when prompt.mode is \"flag\"" });
    }
  });

export type HarnessDescriptorInput = z.input<typeof HarnessDescriptorSchema>;

export interface FieldMapping extends z.infer<typeof FieldMappingSchema> {}
export interface LiveTraceDescriptor extends z.infer<typeof LiveTraceSchema> {}
export interface ModelsDescriptor extends z.infer<typeof ModelsSchema> {}

/** A validated descriptor with all legacy fields folded into their modern form. */
export interface NormalizedDescriptor {
  id: string;
  label: string;
  binNames: string[];
  defaultBin: string;
  binEnvVar?: string;
  wellKnownPaths?: string[];
  versionArgs: string[];
  parser: ParserKind;
  argTemplate: string[];
  extraEnv: Record<string, string>;
  prompt: { mode: "arg" | "flag" | "stdin" | "template"; flag?: string };
  workdirFlag?: string;
  modelFlag?: string;
  maxTurnsFlag?: string;
  permissionFlag?: string;
  permissionArgs?: Record<string, string[]>;
  appendExtraArgs: boolean;
  eventFilter?: string;
  fields: FieldMapping;
  capabilities: {
    reportsCost: boolean;
    reportsTokens: boolean;
    reportsTurns: boolean;
    supportsVisionInput: boolean;
    permissionModes: string[];
  };
  liveTrace?: LiveTraceDescriptor;
  models?: ModelsDescriptor;
}

function legacyOutputToParser(output?: string): ParserKind | undefined {
  if (output === "stream-json") return "claude-stream-json";
  if (output === "jsonl" || output === "json") return "generic-jsonl";
  if (output === "text") return "text";
  return undefined;
}

export interface DescriptorIssue {
  source: string;
  message: string;
}

export function validateDescriptor(
  raw: unknown,
  source: string
): { descriptor: NormalizedDescriptor | null; issues: DescriptorIssue[] } {
  const parsed = HarnessDescriptorSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      source,
      message: `${i.path.join(".") || "(root)"}: ${i.message}`,
    }));
    return { descriptor: null, issues };
  }
  return { descriptor: normalizeDescriptor(parsed.data), issues: [] };
}

export function normalizeDescriptor(d: z.output<typeof HarnessDescriptorSchema>): NormalizedDescriptor {
  const parser = (d.parser ?? legacyOutputToParser(d.output))!;
  const structured = parser === "claude-stream-json" || parser === "codex-jsonl";

  let prompt = d.prompt;
  if (!prompt) {
    if (d.argTemplate.some((t) => t.includes("{prompt}"))) prompt = { mode: "template" };
    else if (d.promptPlaceholder) prompt = { mode: "flag", flag: d.promptPlaceholder };
    else prompt = { mode: "arg" };
  }

  const fields = d.fields ?? {};
  return {
    id: d.id,
    label: d.label,
    binNames: d.binNames,
    defaultBin: d.defaultBin ?? d.binNames[0],
    binEnvVar: d.binEnvVar,
    wellKnownPaths: d.wellKnownPaths,
    versionArgs: d.versionArgs ?? ["--version"],
    parser,
    argTemplate: d.argTemplate,
    extraEnv: d.extraEnv ?? {},
    prompt,
    workdirFlag: d.workdirFlag,
    modelFlag: d.modelFlag,
    maxTurnsFlag: d.maxTurnsFlag,
    permissionFlag: d.permissionFlag,
    permissionArgs: d.permissionArgs,
    appendExtraArgs: d.appendExtraArgs ?? true,
    eventFilter: d.eventFilter,
    fields,
    capabilities: {
      reportsCost: d.capabilities?.reportsCost ?? (structured || !!fields.costUsd),
      reportsTokens: d.capabilities?.reportsTokens ?? (structured || !!fields.inputTokens || !!fields.outputTokens),
      reportsTurns: d.capabilities?.reportsTurns ?? (structured || !!fields.numTurns),
      supportsVisionInput: d.capabilities?.supportsVisionInput ?? false,
      permissionModes: d.capabilities?.permissionModes ?? [...PERMISSION_MODES],
    },
    liveTrace: d.liveTrace,
    models: d.models,
  };
}
