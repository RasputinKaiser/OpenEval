import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getAdapter, hasAdapter, listAdapters } from "./adapters/registry";
import { getPath } from "./adapters/generic";

export interface ModelInfo {
  id: string;
  label: string;
  family: string;
  source: "config" | "alias" | "default";
  contextWindow?: number;
  capabilities: {
    visionInput: boolean;
    visualCodeOutput: boolean;
    notes?: string;
  };
  isAlias?: boolean;
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

function capabilitiesForFamily(family: string, id: string): ModelInfo["capabilities"] {
  const l = id.toLowerCase();
  if (family === "glm") {
    return {
      visionInput: false,
      visualCodeOutput: true,
      notes: "Text-only model; still suitable for SVG, Three.js, web UI, and app UI generation tasks.",
    };
  }
  if (family === "gemini" || l.includes("vision") || l.includes("multimodal")) {
    return { visionInput: true, visualCodeOutput: true };
  }
  return { visionInput: false, visualCodeOutput: true };
}

function modelInfo(input: Omit<ModelInfo, "capabilities">): ModelInfo {
  return { ...input, capabilities: capabilitiesForFamily(input.family, input.id) };
}

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Walk a dotted json path where `*` matches every key at that level, returning
 * all objects found. Used for descriptor `models.discovery.jsonPath`.
 */
function collectAtPath(obj: unknown, parts: string[]): unknown[] {
  if (obj == null) return [];
  if (parts.length === 0) return [obj];
  const [head, ...rest] = parts;
  if (head === "*") {
    if (typeof obj !== "object") return [];
    return Object.values(obj as Record<string, unknown>).flatMap((v) => collectAtPath(v, rest));
  }
  return collectAtPath(getPath(obj, head), rest);
}

const cache = new Map<string, ModelInfo[]>();

/**
 * Models offered for a harness come from its descriptor: a static alias list
 * plus optional discovery of previously-used model ids from a local config
 * file. Nothing here is harness-specific code — it's all descriptor data.
 */
export function discoverModels(harnessId?: string): ModelInfo[] {
  const key = harnessId && hasAdapter(harnessId) ? harnessId : "*";
  const hit = cache.get(key);
  if (hit) return hit;

  const adapters = key === "*" ? listAdapters() : [getAdapter(key)];
  const found = new Map<string, ModelInfo>();

  for (const adapter of adapters) {
    const models = adapter.descriptor.models;
    if (!models) continue;

    for (const a of models.aliases ?? []) {
      if (!found.has(a.id)) {
        found.set(a.id, modelInfo({ id: a.id, label: a.label, family: a.family, source: "alias", isAlias: true }));
      }
    }

    const discovery = models.discovery;
    if (discovery) {
      const file = expandHome(discovery.file);
      if (fs.existsSync(file)) {
        try {
          const data = JSON.parse(fs.readFileSync(file, "utf8"));
          for (const usage of collectAtPath(data, discovery.jsonPath.split("."))) {
            if (!usage || typeof usage !== "object") continue;
            for (const [modelId, stats] of Object.entries(usage as Record<string, unknown>)) {
              if (found.has(modelId)) continue;
              const s = (stats || {}) as any;
              found.set(modelId, modelInfo({
                id: modelId,
                label: labelFromId(modelId),
                family: familyFromId(modelId),
                source: "config",
                contextWindow: typeof s.contextWindow === "number" ? s.contextWindow : undefined,
              }));
            }
          }
        } catch {}
      }
    }

    if (models.default && !found.has(models.default)) {
      found.set(models.default, modelInfo({
        id: models.default,
        label: labelFromId(models.default),
        family: familyFromId(models.default),
        source: "default",
      }));
    }
  }

  const order = ["opus", "sonnet", "haiku", "auto", "glm", "deepseek", "openai", "gemini", "llama", "qwen", "other"];
  const result = Array.from(found.values()).sort((a, b) => {
    const fa = order.indexOf(a.family);
    const fb = order.indexOf(b.family);
    if (fa !== fb) return (fa < 0 ? 99 : fa) - (fb < 0 ? 99 : fb);
    if (a.isAlias !== b.isAlias) return a.isAlias ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
  cache.set(key, result);
  return result;
}

export function isValidModelId(id: string | undefined | null): boolean {
  if (!id) return false;
  return true;
}
