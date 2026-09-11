/**
 * Model taxonomy: provider inference, family grouping, and display labels for any
 * model id seen in the wild. Pure functions — no node imports, safe in client
 * components (unlike lib/models.ts, which is server-only).
 *
 * Goal: every model id from any harness (claude-*, gpt-*, glm-*, gemini-*, llama-*,
 * qwen-*, deepseek-*, mistral-*, kimi-*, grok-*, unknown local ids) gets a provider,
 * a family, and a readable label without a lookup table that goes stale.
 */

export interface ModelTag {
  /** Raw id, untouched (verbatim input preserved for filtering/joins). */
  id: string;
  provider: string;
  family: string;
  label: string;
  providerUnknown: boolean;
}

const PROVIDER_PATTERNS: Array<{ provider: string; re: RegExp }> = [
  { provider: "anthropic", re: /(^|[\/@:.])claude|anthropic/i },
  { provider: "openai", re: /(^|[\/@:.])gpt|(^|[\/@:.])o[134](-|\b)|openai/i },
  { provider: "google", re: /gemini|(^|[\/@:.])palm|google/i },
  { provider: "meta", re: /(^|[\/@:.])llama|(^|[\/@:.])meta-llama/i },
  { provider: "zai", re: /(^|[\/@:.])glm|(^|[\/@:.])z-ai|zhipu/i },
  { provider: "deepseek", re: /deepseek/i },
  { provider: "mistral", re: /mistral|mixtral|magistral/i },
  { provider: "moonshot", re: /kimi|moonshot/i },
  { provider: "xai", re: /(^|[\/@:.])grok|xai/i },
  { provider: "alibaba", re: /(^|[\/@:.])qwen|tongyi/i },
  { provider: "cohere", re: /command(-|\b)|cohere/i },
  { provider: "minimax", re: /minimax|abab/i },
  { provider: "amazon", re: /(^|[\/@:.])nova|titan(-|\b)|bedrock/i },
  { provider: "microsoft", re: /phi-?\d|mai-?\d/i },
  { provider: "nous", re: /hermes(-|\b)|nous/i },
];

const LOCAL_RUNTIME_RE = /localhost|127\.0\.0\.1|ollama|llama\.cpp|lmstudio|mlx/;

const ORG_PREFIXES = [
  "anthropic/", "openai/", "google/", "meta-llama/", "mistralai/", "deepseek-ai/",
  "z-ai/", "moonshotai/", "x-ai/", "qwen/", "microsoft/", "amazon/", "nousresearch/",
  "cohere/", "bedrock/", "vertex/", "openrouter/", "profiles/",
];

export function tagModel(rawId: string): ModelTag {
  const id = rawId.trim();
  const lower = id.toLowerCase();

  let provider = "";
  if (LOCAL_RUNTIME_RE.test(lower)) {
    provider = "local"; // host/runtime prefix beats any model-name signal
  } else {
    for (const { provider: p, re } of PROVIDER_PATTERNS) {
      if (re.test(lower)) { provider = p; break; }
    }
  }

  let core = id;
  for (const prefix of ORG_PREFIXES) {
    if (core.toLowerCase().startsWith(prefix)) { core = core.slice(prefix.length); break; }
  }
  core = core
    .replace(/[:@].*$/, "")            // vendor-qualified (provider:model / ns@model)
    .replace(/-\d{8}\b.*$/, "")        // date-stamped releases
    .replace(/-\d{4,}\b.*$/, "")       // long version codes
    .replace(/-(latest|preview|stable|snapshot|free)$/i, "")
    .replace(/-?(4bit|8bit|q\d[_a-z0-9]*|gguf|awq|gptq|mlx)$/i, "");

  let family: string;
  if (provider === "local") {
    family = "local-runtime";
  } else {
    const m2 = core.toLowerCase().match(/^([a-z0-9]+)(?:-([a-z][a-z0-9]+))?/);
    family = m2 ? (m2[2] ? `${m2[1]}-${m2[2]}` : m2[1]) : "unknown";
  }

  const label = core.replace(/[-_]/g, " ").trim() || id;
  return { id, provider: provider || "unknown", family, label, providerUnknown: provider === "" };
}

/** Group ids by family, preserving each group's first-seen raw id as canonical. */
export function groupByFamily(ids: string[]): Map<string, { canonical: string; ids: string[] }> {
  const groups = new Map<string, { canonical: string; ids: string[] }>();
  for (const id of ids) {
    const { family } = tagModel(id);
    const g = groups.get(family);
    if (g) { if (!g.ids.includes(id)) g.ids.push(id); }
    else groups.set(family, { canonical: id, ids: [id] });
  }
  return groups;
}
