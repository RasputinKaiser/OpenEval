import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface ModelInfo {
  id: string;
  label: string;
  family: string;
  source: "config" | "alias" | "default";
  contextWindow?: number;
  isAlias?: boolean;
}

const KNOWN_ALIASES: Array<{ id: string; label: string; family: string }> = [
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
];

function ncodeConfigPath(): string | null {
  const home = os.homedir();
  const p = path.join(home, ".ncode", ".config.json");
  return fs.existsSync(p) ? p : null;
}

function familyFromId(id: string): string {
  const l = id.toLowerCase();
  if (l.includes("glm")) return "glm";
  if (l.includes("deepseek")) return "deepseek";
  if (l.includes("opus")) return "opus";
  if (l.includes("sonnet")) return "sonnet";
  if (l.includes("haiku")) return "haiku";
  if (l.includes("gpt") || l.includes("o1") || l.includes("o3") || l.includes("o4")) return "openai";
  if (l.includes("gemini")) return "gemini";
  if (l.includes("llama")) return "llama";
  if (l.includes("qwen")) return "qwen";
  return "other";
}

function labelFromId(id: string): string {
  const base = id.split("/").pop() || id;
  const stripped = base.replace(/__FP8$/, "").replace(/__A\d+$/, "");
  const noSuffix = stripped.replace(/\[1m\]$/, " 1M");
  return noSuffix.replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
}

let cache: ModelInfo[] | null = null;

export function discoverModels(): ModelInfo[] {
  if (cache) return cache;
  const found = new Map<string, ModelInfo>();

  for (const a of KNOWN_ALIASES) {
    found.set(a.id, { id: a.id, label: a.label, family: a.family, source: "alias", isAlias: true });
  }

  const cfg = ncodeConfigPath();
  if (cfg) {
    try {
      const data = JSON.parse(fs.readFileSync(cfg, "utf8")) as any;
      const projects = data.projects || {};
      for (const [, proj] of Object.entries(projects) as Array<[string, any]>) {
        const usage = proj.lastModelUsage;
        if (!usage || typeof usage !== "object") continue;
        for (const [modelId, stats] of Object.entries(usage)) {
          const s = (stats || {}) as any;
          if (found.has(modelId)) continue;
          found.set(modelId, {
            id: modelId,
            label: labelFromId(modelId),
            family: familyFromId(modelId),
            source: "config",
            contextWindow: s.contextWindow,
          });
        }
      }
      const teammateDefault = data.teammateDefaultModel;
      if (teammateDefault && !found.has(teammateDefault)) {
        found.set(teammateDefault, {
          id: teammateDefault,
          label: labelFromId(teammateDefault),
          family: familyFromId(teammateDefault),
          source: "default",
        });
      }
    } catch {}
  }

  const order = ["opus", "sonnet", "haiku", "best", "glm", "deepseek", "openai", "gemini", "llama", "qwen", "other"];
  cache = Array.from(found.values()).sort((a, b) => {
    const fa = order.indexOf(a.family);
    const fb = order.indexOf(b.family);
    if (fa !== fb) return (fa < 0 ? 99 : fa) - (fb < 0 ? 99 : fb);
    if (a.isAlias !== b.isAlias) return a.isAlias ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
  return cache;
}

export function isValidModelId(id: string | undefined | null): boolean {
  if (!id) return false;
  return true;
}