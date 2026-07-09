/**
 * Token pricing so cost can be ESTIMATED for sessions whose harness never
 * recorded one (persisted Claude/Codex/ncode session files carry token usage but
 * no cost). Estimated costs are always provenance "inferred", never "measured".
 *
 * Rates are USD per MILLION tokens, sourced from OpenRouter's published model
 * prices (https://openrouter.ai/api/v1/models) as of 2026-07 — the goal is a
 * correct ballpark, not a billing statement. A named model with no specific
 * entry falls back to DEFAULT_RATE (a conservative open-model guess) so cost is
 * never a misleading $0; only a null/empty model id yields no cost. Cache-write
 * (cache-creation) rates aren't published per-model, so Anthropic models use the
 * usual 1.25x-input convention and others fall back to the input rate.
 */
export interface TokenRate {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const PRICING_LIST_DATE = "2026-07";
export const PRICING_SOURCE = "OpenRouter list prices";

/** Conservative open-model fallback for any named-but-unlisted model. */
export const DEFAULT_RATE: TokenRate = { input: 1, output: 3, cacheRead: 0.1, cacheWrite: 1.25 };

/** First matcher (on the lowercased id) wins — specific patterns before families. */
const RATE_TABLE: Array<{ match: (id: string) => boolean; rate: TokenRate }> = [
  // --- Anthropic Claude (OpenRouter: opus-4.8 5/25, sonnet-5 2/10, fable-5 10/50) ---
  { match: (id) => id.includes("fable"), rate: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 } },
  { match: (id) => id.includes("opus"), rate: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 } },
  { match: (id) => id.includes("sonnet"), rate: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 } },
  { match: (id) => id.includes("haiku"), rate: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 } },
  // --- OpenAI GPT / Codex (OpenRouter: gpt-5.5 5/30) ---
  { match: (id) => /gpt-5|codex|o4|o3/.test(id), rate: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 5 } },
  // --- Open models (OpenRouter: glm-5.2 0.9/3.08, deepseek-v4-pro 0.435/0.87) ---
  { match: (id) => id.includes("glm"), rate: { input: 0.9, output: 3.08, cacheRead: 0.18, cacheWrite: 1.13 } },
  { match: (id) => id.includes("deepseek"), rate: { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0.544 } },
  { match: (id) => id.includes("qwen"), rate: { input: 0.4, output: 1.2, cacheRead: 0.04, cacheWrite: 0.5 } },
];

export interface ModelRate {
  rate: TokenRate;
  /** false when this came from DEFAULT_RATE (a rough guess), true for a listed model. */
  exact: boolean;
}

/** Resolve a rate for a model. Null only for a null/empty id (can't guess nothing). */
export function rateForModelInfo(model: string | null | undefined): ModelRate | null {
  if (!model || !model.trim()) return null;
  const id = model.toLowerCase();
  for (const entry of RATE_TABLE) {
    if (entry.match(id)) return { rate: entry.rate, exact: true };
  }
  return { rate: DEFAULT_RATE, exact: false };
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
 * Estimate a session's cost from its token breakdown and model. Returns null if
 * the model id is empty (can't guess) or there are no tokens to price.
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
