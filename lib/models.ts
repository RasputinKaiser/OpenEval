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
    /** null means this model's capability is not proven by local metadata. */
    visionInput: boolean | null;
    visualCodeOutput: boolean | null;
    notes?: string;
  };
  isAlias?: boolean;
}

export type ModelDefaultSource = "descriptor" | "config" | "none";

export interface ResolvedModelDefault {
  id?: string;
  source: ModelDefaultSource;
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

function capabilitiesForFamily(family: string, id: string, harnessSupportsVision: boolean | null): ModelInfo["capabilities"] {
  const l = id.toLowerCase();
  if (family === "gemini" || l.includes("vision") || l.includes("multimodal")) {
    return { visionInput: true, visualCodeOutput: true };
  }
  // The harness can prove that it accepts image attachments, but that does
  // not prove every arbitrary configured model accepts them. Model-specific
  // metadata or an explicit alias declaration is required for "vision".
  return {
    visionInput: null,
    visualCodeOutput: null,
    notes: harnessSupportsVision === true
      ? "This harness accepts image attachments; model-specific image support is not declared locally."
      : "Model-specific image support is not declared locally.",
  };
}

/** Resolve the model that a run should record when the caller leaves it blank. */
export function resolveDefaultModel(harnessId: string): ResolvedModelDefault {
  if (!hasAdapter(harnessId)) return { source: "none" };
  const descriptorDefault = getAdapter(harnessId).descriptor.models?.default;
  if (descriptorDefault) return { id: descriptorDefault, source: "descriptor" };
  const configured = configuredDefaultModel(harnessId);
  if (configured) return { id: configured, source: "config" };
  return { source: "none" };
}

type ModelCapabilityOverrides = Partial<ModelInfo["capabilities"]>;

function modelInfo(
  input: Omit<ModelInfo, "capabilities"> & { capabilities?: ModelCapabilityOverrides },
  harnessSupportsVision: boolean | null,
): ModelInfo {
  const { capabilities, ...rest } = input;
  return {
    ...rest,
    capabilities: { ...capabilitiesForFamily(input.family, input.id, harnessSupportsVision), ...capabilities },
  };
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

function configuredModelIds(harnessId: string): string[] {
  if (harnessId === "codex") {
    const file = expandHome("~/.codex/config.toml");
    try {
      const text = fs.readFileSync(file, "utf8");
      return [...text.matchAll(/^\s*model\s*=\s*["']([^"']+)["']\s*$/gm)].map((m) => m[1]);
    } catch {}
  }
  if (harnessId === "hermes") {
    const file = expandHome("~/.hermes/config.yaml");
    try {
      const text = fs.readFileSync(file, "utf8");
      const match = text.match(/^\s+default:\s*([^#\s]+)\s*$/m);
      return match ? [match[1]] : [];
    } catch {}
  }
  return [];
}

export function configuredDefaultModel(harnessId: string): string | undefined {
  if (harnessId === "codex") {
    const file = expandHome("~/.codex/config.toml");
    try {
      const text = fs.readFileSync(file, "utf8");
      // The first root-level model assignment is Codex's active default;
      // profile assignments below it are alternatives, not the default.
      return text.match(/^model\s*=\s*["']([^"']+)["']\s*$/m)?.[1];
    } catch {}
  }
  if (harnessId === "hermes") {
    const file = expandHome("~/.hermes/config.yaml");
    try {
      const text = fs.readFileSync(file, "utf8");
      return text.match(/^\s+default:\s*([^#\s]+)\s*$/m)?.[1];
    } catch {}
  }
  return undefined;
}

/**
 * Models offered for a harness come from its descriptor: a static alias list
 * plus optional discovery of previously-used model ids from a local config
 * file. Nothing here is harness-specific code — it's all descriptor data.
 */
export function discoverModels(harnessId?: string): ModelInfo[] {
  // An explicit unknown harness must not silently receive another harness's
  // model catalog. That made `/api/models?harness=typo` look valid.
  if (harnessId && !hasAdapter(harnessId)) return [];
  const key = harnessId || "*";
  const hit = cache.get(key);
  if (hit) return hit;

  const adapters = key === "*" ? listAdapters() : [getAdapter(key)];
  const found = new Map<string, ModelInfo>();

  for (const adapter of adapters) {
    const models = adapter.descriptor.models;
    const harnessSupportsVision = adapter.capabilities.supportsVisionInput;

    for (const a of models?.aliases ?? []) {
      if (!found.has(a.id)) {
        found.set(a.id, modelInfo({
          id: a.id,
          label: a.label,
          family: a.family,
          source: "alias",
          isAlias: true,
          capabilities: a.capabilities,
        }, harnessSupportsVision));
      }
    }

    const discovery = models?.discovery;
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
              }, harnessSupportsVision));
            }
          }
        } catch {}
      }
    }

    for (const modelId of configuredModelIds(adapter.id)) {
      if (!found.has(modelId)) {
        found.set(modelId, modelInfo({
          id: modelId,
          label: labelFromId(modelId),
          family: familyFromId(modelId),
          source: "config",
        }, harnessSupportsVision));
      }
    }

    if (models?.default && !found.has(models.default)) {
      found.set(models.default, modelInfo({
        id: models.default,
        label: labelFromId(models.default),
        family: familyFromId(models.default),
        source: "default",
      }, harnessSupportsVision));
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
