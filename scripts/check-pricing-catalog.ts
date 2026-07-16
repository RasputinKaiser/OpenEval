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
      note: "Cache-write rates are not checked because the catalog does not consistently publish them.",
    }));
  }
}

void main();
