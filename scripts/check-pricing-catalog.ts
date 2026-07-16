import { listedPricingCatalog, PRICING_LIST_DATE, PRICING_SOURCE } from "../lib/pricing";

async function main(): Promise<void> {
  const endpoint = "https://openrouter.ai/api/v1/models";
  const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Pricing catalog request failed: HTTP ${response.status}`);

  const payload = await response.json() as {
    data?: Array<{ id?: string; pricing?: Record<string, string | number | null | undefined> }>;
  };
  const liveById = new Map((payload.data ?? []).map((model) => [model.id, model]));
  const mismatches: string[] = [];
  const unverifiedDimensions: string[] = [];
  const fields = [
    ["input", "prompt"],
    ["output", "completion"],
    ["cacheRead", "input_cache_read"],
  ] as const;

  for (const entry of listedPricingCatalog()) {
    const live = liveById.get(entry.sourceModel);
    if (!live) {
      mismatches.push(`${entry.sourceModel}: missing from ${endpoint}`);
      continue;
    }
    for (const [rateField, apiField] of fields) {
      const raw = live.pricing?.[apiField];
      const actual = raw == null ? Number.NaN : Number(raw) * 1_000_000;
      const expected = entry.rate[rateField];
      if (!Number.isFinite(actual)) {
        mismatches.push(`${entry.sourceModel}.${apiField}: live value missing (expected ${expected}/M)`);
      } else if (Math.abs(actual - expected) > 1e-9) {
        mismatches.push(`${entry.sourceModel}.${apiField}: live ${actual}/M != local ${expected}/M`);
      }
    }
    const cacheWriteRaw = live.pricing?.input_cache_write;
    if (cacheWriteRaw == null) {
      unverifiedDimensions.push(`${entry.sourceModel}.input_cache_write`);
    } else {
      const actual = Number(cacheWriteRaw) * 1_000_000;
      if (!Number.isFinite(actual)) {
        mismatches.push(`${entry.sourceModel}.input_cache_write: live value is not numeric`);
      } else if (Math.abs(actual - entry.rate.cacheWrite) > 1e-9) {
        mismatches.push(`${entry.sourceModel}.input_cache_write: live ${actual}/M != local ${entry.rate.cacheWrite}/M`);
      }
    }
  }

  if (mismatches.length > 0) {
    console.error(mismatches.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({
      ok: true,
      checked: listedPricingCatalog().length,
      source: PRICING_SOURCE,
      localListDate: PRICING_LIST_DATE,
      endpoint,
      verifiedDimensions: ["prompt", "completion", "input_cache_read"],
      unverifiedDimensions,
      note: "Cache-write rates are checked when published; absent fields are reported explicitly as unverified.",
    }));
  }
}

void main();
