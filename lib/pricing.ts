/**
 * API-equivalent token pricing for transcript sessions that do not record a
 * dollar cost. These estimates are NOT the user's actual subscription or
 * provider spend. They answer the narrower question: what would the recorded
 * token classes cost at the referenced public list rate?
 *
 * Resolution order: (1) OpenRouter's live catalog snapshot (real per-token
 * list rates, refreshed from /api/v1/models — $0 free tiers are real list
 * prices), (2) the compiled-in list, (3) family mappings, (4) the conservative
 * DEFAULT_RATE fallback. Unknown named models keep a visibly flagged fallback
 * estimate instead of becoming a misleading $0.
 */
import { lookupOpenRouterPricing, openRouterCatalogIds, openRouterSnapshotFetchedAt } from "./pricing-catalog";

export interface TokenRate {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export type RateConfidence = "listed" | "family" | "fallback";

export const PRICING_LIST_DATE = "2026-07-30";

/**
 * Freshness the UI should display: the live catalog snapshot's fetch date when
 * one is loaded (Tier A answers lookups), otherwise the compiled list date.
 * Keeps "rates checked {date}" honest once the snapshot refreshes.
 */
export function pricingProvenanceDate(): string {
  const fetched = openRouterSnapshotFetchedAt();
  if (fetched) {
    const date = fetched.slice(0, 10);
    // Prefer the newer of snapshot vs compiled list date.
    return date > PRICING_LIST_DATE ? date : PRICING_LIST_DATE;
  }
  return PRICING_LIST_DATE;
}
export const PRICING_SOURCE = "OpenRouter /api/v1/models";

/** Conservative open-model fallback for any named-but-unlisted model. */
export const DEFAULT_RATE: TokenRate = { input: 1, output: 3, cacheRead: 0.1, cacheWrite: 1.25 };

interface ListedRate {
  sourceModel: string;
  aliases: string[];
  rate: TokenRate;
}

export interface ListedPricingCatalogEntry {
  sourceModel: string;
  rate: TokenRate;
}

/** Exact ids/aliases whose public list-rate identity is known. */
const LISTED_RATES: ListedRate[] = [
  { sourceModel: "anthropic/claude-fable-5", aliases: ["claude-fable-5", "anthropic/claude-fable-5"], rate: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 } },
  { sourceModel: "anthropic/claude-opus-4.8", aliases: ["claude-opus-4-8", "anthropic/claude-opus-4.8"], rate: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 } },
  { sourceModel: "anthropic/claude-sonnet-5", aliases: ["claude-sonnet-5", "anthropic/claude-sonnet-5"], rate: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 } },
  { sourceModel: "anthropic/claude-sonnet-4.6", aliases: ["claude-sonnet-4-6", "anthropic/claude-sonnet-4.6"], rate: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  { sourceModel: "anthropic/claude-haiku-4.5", aliases: ["claude-haiku-4-5", "anthropic/claude-haiku-4.5"], rate: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 } },

  { sourceModel: "openai/gpt-5.6-sol", aliases: ["gpt-5.6-sol", "openai/gpt-5.6-sol"], rate: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 } },
  { sourceModel: "openai/gpt-5.6-luna", aliases: ["gpt-5.6-luna", "openai/gpt-5.6-luna"], rate: { input: 0.1, output: 0.6, cacheRead: 0.01, cacheWrite: 0.125 } },
  { sourceModel: "openai/gpt-5.6-terra", aliases: ["gpt-5.6-terra", "openai/gpt-5.6-terra"], rate: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 3.125 } },
  { sourceModel: "openai/gpt-5.5", aliases: ["gpt-5.5", "openai/gpt-5.5"], rate: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 5 } },
  { sourceModel: "openai/gpt-5.4", aliases: ["gpt-5.4", "openai/gpt-5.4"], rate: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 2.5 } },
  { sourceModel: "openai/gpt-5.4-mini", aliases: ["gpt-5.4-mini", "openai/gpt-5.4-mini"], rate: { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0.75 } },
  { sourceModel: "openai/gpt-5.3-codex", aliases: ["gpt-5.3-codex", "openai/gpt-5.3-codex"], rate: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 1.75 } },
  { sourceModel: "openai/gpt-5.1-codex-max", aliases: ["gpt-5.1-codex-max", "openai/gpt-5.1-codex-max"], rate: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 } },
  { sourceModel: "openai/gpt-5.1-codex", aliases: ["gpt-5.1-codex", "openai/gpt-5.1-codex"], rate: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 } },
  { sourceModel: "openai/gpt-5-codex", aliases: ["gpt-5-codex", "openai/gpt-5-codex"], rate: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 } },
  { sourceModel: "openai/gpt-5", aliases: ["gpt-5", "openai/gpt-5"], rate: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 } },
  { sourceModel: "openai/o4-mini", aliases: ["o4-mini", "openai/o4-mini"], rate: { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 1.1 } },

  { sourceModel: "stealth/ox-alpha", aliases: ["ox-alpha", "stealth/ox-alpha"], rate: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },

  { sourceModel: "z-ai/glm-5.2", aliases: ["z-ai/glm-5.2"], rate: { input: 0.952, output: 2.992, cacheRead: 0.1768, cacheWrite: 0.952 } },
  { sourceModel: "deepseek/deepseek-v4-pro", aliases: ["deepseek/deepseek-v4-pro"], rate: { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0.435 } },
  { sourceModel: "deepseek/deepseek-v4-flash", aliases: ["deepseek/deepseek-v4-flash"], rate: { input: 0.098, output: 0.196, cacheRead: 0.02, cacheWrite: 0.098 } },
  { sourceModel: "moonshotai/kimi-k2.7-code", aliases: ["moonshotai/kimi-k2.7-code"], rate: { input: 0.719, output: 3.49, cacheRead: 0.149, cacheWrite: 0.719 } },
];

const LISTED_BY_ALIAS = new Map<string, ListedRate>();
for (const entry of LISTED_RATES) {
  for (const alias of entry.aliases) LISTED_BY_ALIAS.set(alias, entry);
}

/**
 * Tier-A rates: OpenRouter's live catalog (see ./pricing-catalog). An exact
 * catalog id — or a resolvable alias of one, e.g. `glm-5.3-flash` →
 * `z-ai/glm-5.3-flash`, `stepfun/step-3.7-flash:free` → `stepfun/step-3.7-flash`
 * — is a LISTED rate even when the list price is $0 (free tiers are real
 * prices). Alias resolution order: exact id, hf: prefix strip, :free suffix
 * strip/add, bare-leaf → vendor/<leaf> match preferring :free when the
 * display id said free.
 */
function catalogRate(id: string): ModelRate | null {
  let entry = lookupOpenRouterPricing(id);
  if (!entry) {
    let lower = id.toLowerCase();
    if (lower.startsWith("hf:")) {
      lower = lower.slice(3);
      entry = lookupOpenRouterPricing(lower);
    }
    if (!entry) {
      const candidates: string[] = [];
      if (lower.endsWith(":free")) {
        const base = lower.slice(0, -5);
        candidates.push(base);
      } else {
        candidates.push(`${lower}:free`);
      }
      const leaf = lower.split("/").pop()!.split(":")[0];
      for (const key of openRouterCatalogIds()) {
        const keyLeaf = key.split("/").pop()!.split(":")[0];
        if (keyLeaf === leaf) {
          if (lower.endsWith(":free") && key.endsWith(":free")) candidates.unshift(key);
          else if (!lower.endsWith(":free") && !key.endsWith(":free")) candidates.push(key);
        }
      }
      for (const candidate of candidates) {
        const hit = lookupOpenRouterPricing(candidate);
        if (hit) { entry = hit; break; }
      }
    }
  }
  if (!entry) return null;
  const p = entry.pricing;
  // Defense in depth: seed/manual entry paths bypass parseEntry, so the rate
  // consumer re-checks for the -1 dynamic-pricing sentinel.
  if (p.prompt < 0 || p.completion < 0) return null;
  return {
    rate: {
      input: p.prompt * 1_000_000,
      output: p.completion * 1_000_000,
      cacheRead: (p.input_cache_read ?? p.prompt * 0.1) * 1_000_000,
      cacheWrite: (p.input_cache_write ?? p.prompt) * 1_000_000,
    },
    exact: true,
    confidence: "listed",
    sourceModel: entry.id,
  };
}

/** Public list-rate ids used by the reproducible catalog drift check. */
export function listedPricingCatalog(): ListedPricingCatalogEntry[] {
  return LISTED_RATES.map((entry) => ({ sourceModel: entry.sourceModel, rate: { ...entry.rate } }));
}

/** Remove machine-specific model-store prefixes while preserving identity. */
export function displayModelId(model: string | null | undefined): string | null {
  if (!model || !model.trim()) return null;
  const id = model.trim();
  const marker = "/data/models/hf/";
  const markerAt = id.toLowerCase().lastIndexOf(marker);
  if (markerAt >= 0) {
    const stored = id.slice(markerAt + marker.length).replace(/__/g, "/");
    return `hf:${stored.toLowerCase()}`;
  }
  // Local model-store paths (/Users/<name>/..., /home/<name>/...) name the
  // operator's account on every row they appear in. Keep the model identity
  // (the leaf segment) and the store, drop the username-bearing prefix — the
  // same policy displayModelId already applies to the HF cache marker.
  const homeMatch = id.match(/^\/(?:Users|home)\/[^/]+\/(.+)$/);
  if (homeMatch) return id.slice(id.length - homeMatch[1].length).toLowerCase();
  return id;
}

export interface ModelRate {
  rate: TokenRate;
  /** Backward-compatible shorthand: true only for a directly listed model id. */
  exact: boolean;
  confidence: RateConfidence;
  /** Public list-price model used for the estimate, or "fallback". */
  sourceModel: string;
}

const PLACEHOLDER_MODEL_IDS = new Set(["<synthetic>", "synthetic", "unknown", "null", "none"]);

export function isPlaceholderModel(model: string | null | undefined): boolean {
  const id = model?.trim().toLowerCase();
  return !id || PLACEHOLDER_MODEL_IDS.has(id);
}

function familyRate(id: string): ListedRate | null {
  const from = (sourceModel: string) => LISTED_RATES.find((entry) => entry.sourceModel === sourceModel) ?? null;
  if (id.startsWith("hf:zai-org/glm-5.2") || id === "glm 5.2 (1m)") return from("z-ai/glm-5.2");
  if (id.startsWith("hf:moonshotai/kimi-k2.7-code")) return from("moonshotai/kimi-k2.7-code");
  if (id === "deepseek-ai/deepseek-v4-pro" || id === "deepseek-v4-pro") return from("deepseek/deepseek-v4-pro");
  if (id === "deepseek-ai/deepseek-v4-flash" || id === "deepseek-v4-flash") return from("deepseek/deepseek-v4-flash");
  if (id.startsWith("gpt-5.3-codex-")) return from("openai/gpt-5.3-codex");
  if (id.startsWith("gpt-5.5-")) return from("openai/gpt-5.5");
  if (id.includes("fable")) return from("anthropic/claude-fable-5");
  if (id.includes("opus")) return from("anthropic/claude-opus-4.8");
  if (id.includes("sonnet")) return from("anthropic/claude-sonnet-5");
  if (id.includes("haiku")) return from("anthropic/claude-haiku-4.5");
  return null;
}

function resolveRateForModelInfo(model: string): ModelRate | null {
  if (isPlaceholderModel(model)) return null;
  const display = displayModelId(model);
  if (!display) return null;
  const id = display.toLowerCase();
  // Tier A: live OpenRouter catalog rates (includes $0 free tiers).
  const catalog = catalogRate(id);
  if (catalog) return catalog;
  const listed = LISTED_BY_ALIAS.get(id);
  if (listed) return { rate: listed.rate, exact: true, confidence: "listed", sourceModel: listed.sourceModel };
  const family = familyRate(id);
  if (family) return { rate: family.rate, exact: false, confidence: "family", sourceModel: family.sourceModel };
  return { rate: DEFAULT_RATE, exact: false, confidence: "fallback", sourceModel: "fallback" };
}

// Real transcript corpora contain only ~dozens of distinct model ids, so this
// memo stays tiny; the cap only guards against a pathological corpus full of
// fabricated model strings. Safe because the catalog above is a module-level
// constant with no runtime mutation path. Cached ModelRate objects are shared
// across calls (as their inner TokenRate already was) — callers must not
// mutate them.
const RATE_MEMO_MAX = 4096;
const rateMemo = new Map<string, ModelRate | null>();

/** Resolve a rate for a real model id. Placeholder/sentinel ids stay unpriced. */
export function rateForModelInfo(model: string | null | undefined): ModelRate | null {
  if (model == null) return null;
  const cached = rateMemo.get(model);
  if (cached !== undefined) return cached;
  const resolved = resolveRateForModelInfo(model);
  if (rateMemo.size >= RATE_MEMO_MAX) rateMemo.clear();
  rateMemo.set(model, resolved);
  return resolved;
}

/**
 * The memo assumes the catalog is stable within a process; the live catalog
 * layer invalidates it whenever its in-memory map is reseeded (network
 * refresh, test seed), so rates follow the catalog, not first-call timing.
 */
export function clearRateMemoForTests(): void {
  rateMemo.clear();
}

export function rateForModel(model: string | null | undefined): TokenRate | null {
  return rateForModelInfo(model)?.rate ?? null;
}

export interface TokenBreakdown {
  input: number;
  output: number;
  cacheRead?: number;
  cacheCreate?: number;
}

/**
 * Estimate API-equivalent cost from token classes. Long-context request
 * surcharges cannot be reconstructed from an aggregate alone and are excluded;
 * the UI states this boundary explicitly.
 */
export function estimateCostUsd(model: string | null | undefined, tokens: TokenBreakdown): number | null {
  const rate = rateForModel(model);
  if (!rate) return null;
  const input = Math.max(0, tokens.input || 0);
  const output = Math.max(0, tokens.output || 0);
  const cacheRead = Math.max(0, tokens.cacheRead || 0);
  const cacheCreate = Math.max(0, tokens.cacheCreate || 0);
  if (input + output + cacheRead + cacheCreate === 0) return null;
  return (
    (input * rate.input +
      output * rate.output +
      cacheRead * rate.cacheRead +
      cacheCreate * rate.cacheWrite) /
    1_000_000
  );
}
