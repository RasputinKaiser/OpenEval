import type { HarnessDescriptorInput } from "./schema";

/**
 * Bundled harness descriptors. These use the exact same schema as user
 * descriptors in `harnesses/*.harness.json` — no bundled harness has powers a
 * user-defined one lacks. A user descriptor with the same id overrides these.
 */
export const BUILTIN_DESCRIPTORS: HarnessDescriptorInput[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    binNames: ["claude"],
    binEnvVar: "CLAUDE_BIN",
    wellKnownPaths: ["~/.local/bin/claude", "~/.claude/local/claude"],
    parser: "claude-stream-json",
    argTemplate: ["-p", "--output-format", "stream-json", "--input-format", "text"],
    permissionFlag: "--permission-mode",
    workdirFlag: "--add-dir",
    modelFlag: "--model",
    maxTurnsFlag: "--max-turns",
    prompt: { mode: "arg" },
    capabilities: { supportsVisionInput: true },
    models: {
      aliases: [
        { id: "opus", label: "Opus", family: "opus", capabilities: { visionInput: true, visualCodeOutput: true } },
        { id: "sonnet", label: "Sonnet", family: "sonnet", capabilities: { visionInput: true, visualCodeOutput: true } },
        { id: "sonnet[1m]", label: "Sonnet 1M", family: "sonnet", capabilities: { visionInput: true, visualCodeOutput: true } },
        { id: "haiku", label: "Haiku", family: "haiku", capabilities: { visionInput: true, visualCodeOutput: true } },
      ],
    },
    liveTrace: {
      format: "claude-projects",
      roots: ["~/.claude/projects"],
      maxDepth: 2,
    },
  },
  {
    id: "codex",
    label: "Codex CLI + ChatGPT app",
    binNames: ["codex"],
    binEnvVar: "CODEX_BIN",
    wellKnownPaths: ["~/.local/bin/codex", "~/.codex/bin/codex"],
    parser: "codex-jsonl",
    argTemplate: ["exec", "--json", "--skip-git-repo-check"],
    permissionArgs: {
      bypassPermissions: ["--dangerously-bypass-approvals-and-sandbox"],
      default: ["-s", "read-only"],
      "*": ["-s", "workspace-write"],
    },
    modelFlag: "-m",
    prompt: { mode: "arg" },
    // `codex --help` exposes `-i/--image` for both interactive and `exec`
    // modes. Cost is intentionally false because JSONL output does not report
    // a measured USD field.
    capabilities: {
      reportsCost: false,
      supportsVisionInput: true,
      permissionModes: ["bypassPermissions", "default"],
    },
    liveTrace: {
      format: "codex-sessions",
      roots: ["~/.codex/sessions", "~/.codex/archived_sessions"],
      maxDepth: 5,
    },
  },
  {
    id: "ncode",
    label: "Noumena Code (ncode)",
    binNames: ["ncode"],
    binEnvVar: "NCODE_BIN",
    wellKnownPaths: ["~/.local/bin/ncode", "~/.ncode/bin/ncode"],
    parser: "claude-stream-json",
    argTemplate: ["-p", "--output-format", "stream-json", "--input-format", "text"],
    extraEnv: { NCODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
    permissionFlag: "--permission-mode",
    workdirFlag: "--add-dir",
    modelFlag: "--model",
    maxTurnsFlag: "--max-turns",
    prompt: { mode: "arg" },
    capabilities: { supportsVisionInput: true },
    models: {
      default: "glm-5.2",
      aliases: [
        { id: "opus", label: "Opus", family: "opus" },
        { id: "opus[1m]", label: "Opus 1M", family: "opus" },
        { id: "sonnet", label: "Sonnet", family: "sonnet" },
        { id: "sonnet[1m]", label: "Sonnet 1M", family: "sonnet" },
        { id: "haiku", label: "Haiku", family: "haiku" },
        { id: "best", label: "Best (auto)", family: "auto" },
        { id: "glm-5.2", label: "GLM-5.2", family: "glm" },
        { id: "glm-5.2[1m]", label: "GLM-5.2 1M", family: "glm" },
        { id: "deepseek-v4", label: "DeepSeek V4", family: "deepseek" },
        { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", family: "deepseek" },
      ],
      discovery: {
        file: "~/.ncode/.config.json",
        jsonPath: "projects.*.lastModelUsage",
      },
    },
    liveTrace: {
      format: "claude-projects",
      roots: ["~/.ncode/projects"],
      maxDepth: 2,
      inferredModel: "GLM 5.2 (1M)",
    },
  },
];
