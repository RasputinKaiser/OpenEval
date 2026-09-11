#!/usr/bin/env node
/**
 * Refresh the OpenRouter pricing catalog snapshot (data/openrouter-pricing.json).
 *
 * Run via cron/launchd or manually; the dashboard's pricing tier reads this
 * snapshot lazily on first lookup, so a stale file only costs rate drift,
 * never downtime. Without network access the existing snapshot is untouched.
 */
import fs from "node:fs";
import path from "node:path";

const CATALOG_URL = "https://openrouter.ai/api/v1/models";
const dataRoot = process.env.OPENEVAL_DATA_ROOT
  ? path.resolve(process.env.OPENEVAL_DATA_ROOT)
  : path.join(process.cwd(), "data");
const file = path.join(dataRoot, "openrouter-pricing.json");

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 15_000);
try {
  const response = await fetch(CATALOG_URL, { signal: controller.signal, headers: { accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const models = [];
  for (const row of rows) {
    const id = typeof row?.id === "string" ? row.id.toLowerCase() : null;
    const p = row?.pricing ?? {};
    const prompt = Number(p.prompt);
    const completion = Number(p.completion);
    // Reject the -1 dynamic-pricing sentinel OpenRouter uses for router
    // models; pricing with it produced a -$1.2M estimate.
    if (!id || !Number.isFinite(prompt) || !Number.isFinite(completion) || prompt < 0 || completion < 0) continue;
    const cacheRead = Number(p.input_cache_read);
    const cacheWrite = Number(p.input_cache_write);
    models.push({
      id,
      pricing: {
        prompt,
        completion,
        ...(Number.isFinite(cacheRead) ? { input_cache_read: cacheRead } : {}),
        ...(Number.isFinite(cacheWrite) ? { input_cache_write: cacheWrite } : {}),
      },
    });
  }
  if (models.length === 0) throw new Error("no parsable models in catalog response");
  const fetchedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ fetchedAt, source: "OpenRouter /api/v1/models", models }), "utf8");
  console.log(`openrouter-pricing: wrote ${models.length} models to ${file}`);
} catch (error) {
  console.error(`openrouter-pricing refresh failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}
