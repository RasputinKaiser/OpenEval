/**
 * OpenRouter catalog pricing — in-memory tier (Tier A of the pricing stack).
 *
 * OpenRouter publishes real per-token list rates for every model it routes —
 * including $0 for `:free` variants. Those rates are authoritative for
 * API-equivalent estimates: a free model priced from its catalog entry is a
 * LISTED rate, not an unflagged fallback guess.
 *
 * Hydration: the persisted snapshot (data/openrouter-pricing.json) is loaded
 * lazily on the first lookup — the first estimate of a server process pays a
 * one-time ~5ms read, every later lookup is a map hit. The snapshot is
 * refreshed from the network by scripts/refresh-pricing-catalog.mjs (cron or
 * manual); tests seed the map directly. This module never statically imports
 * Node builtins: pricing.ts is reachable from shared lib code that client
 * components import, so this module must stay server-only.
 */

import fs from "node:fs";
import pathMod from "node:path";
import { clearRateMemoForTests } from "./pricing";

export interface OpenRouterCatalogPricing {
  prompt: number; // USD per token
  completion: number; // USD per token
  input_cache_read?: number; // USD per token
  input_cache_write?: number; // USD per token
}

export interface OpenRouterCatalogEntry {
  id: string;
  pricing: OpenRouterCatalogPricing;
}

export interface PricingCatalogStats {
  entries: number;
  fetchedAt: string | null;
  source: "network" | "snapshot" | "test-seed" | "none";
  lastError: string | null;
}

const inMemory = new Map<string, OpenRouterCatalogEntry>();
let stats: PricingCatalogStats = { entries: 0, fetchedAt: null, source: "none", lastError: null };
let hydrateAttempted = false;

/**
 * Runtime require, invisible to webpack/turbopack static analysis (same
 * escape hatch as redaction.ts's dynamic import). Server contexts have
 * `require`; client bundles never execute this path.
 */
// (no runtime require shim — static node builtins; see import above)

function hydrateFromSnapshotOnce(): void {
  if (hydrateAttempted) return;
  hydrateAttempted = true;
  // Tests pin the compiled-tier expectations; a developer-machine snapshot
  // must not make them environment-dependent.
  if (process.env.OPENEVAL_DISABLE_PRICING_SNAPSHOT === "1") return;
  if (inMemory.size > 0) return;
  try {
    const dataRoot = process.env.OPENEVAL_DATA_ROOT
      ? pathMod.resolve(process.env.OPENEVAL_DATA_ROOT)
      : pathMod.join(process.cwd(), "data");
    const raw = JSON.parse(fs.readFileSync(pathMod.join(dataRoot, "openrouter-pricing.json"), "utf8")) as {
      fetchedAt?: unknown;
      models?: Array<{ id?: unknown; pricing?: Record<string, unknown> }>;
    };
    if (!Array.isArray(raw.models)) return;
    const entries = raw.models
      .map(parseEntry)
      .filter((e): e is OpenRouterCatalogEntry => e !== null);
    if (entries.length === 0) return;
    const fetchedAt = typeof raw.fetchedAt === "string" ? raw.fetchedAt : new Date(0).toISOString();
    ingest(entries, "snapshot", fetchedAt);
  } catch {
    // No snapshot / unreadable — the compiled list + family + fallback tiers carry on.
  }
}

function parseEntry(raw: {
  id?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown; input_cache_read?: unknown; input_cache_write?: unknown };
}): OpenRouterCatalogEntry | null {
  if (typeof raw?.id !== "string" || !raw.id || typeof raw.pricing !== "object" || raw.pricing === null) return null;
  const prompt = Number(raw.pricing.prompt);
  const completion = Number(raw.pricing.completion);
  // OpenRouter marks dynamic-priced router models (openrouter/auto, fusion…) with a -1
  // sentinel, not a real rate. Pricing a session with -1/M turns cache reads into a
  // multi-million-dollar negative estimate — reject sentinels and unparsable rows alike so
  // those models fall through to the family/fallback tiers honestly.
  if (!Number.isFinite(prompt) || !Number.isFinite(completion) || prompt < 0 || completion < 0) return null;
  const cacheRead = Number(raw.pricing.input_cache_read);
  const cacheWrite = Number(raw.pricing.input_cache_write);
  return {
    id: raw.id.toLowerCase(),
    pricing: {
      prompt,
      completion,
      input_cache_read: Number.isFinite(cacheRead) ? cacheRead : undefined,
      input_cache_write: Number.isFinite(cacheWrite) ? cacheWrite : undefined,
    },
  };
}

function ingest(entries: OpenRouterCatalogEntry[], source: PricingCatalogStats["source"], fetchedAt: string): void {
  inMemory.clear();
  for (const entry of entries) inMemory.set(entry.id, entry);
  stats = { entries: inMemory.size, fetchedAt, source, lastError: null };
  // Rate lookups memoize per id; a reseeded catalog must not serve stale
  // memoized rates computed against the previous catalog state. Synchronous
  // on purpose: seeds and snapshot loads take effect atomically. The static
  // pricing<->catalog import cycle is safe: the consumed binding is a hoisted
  // function declaration, evaluated after both modules initialize.
  clearRateMemoForTests();
}

/** Test/seed hook: install entries directly (marks source "test-seed"). */
export function setOpenRouterCatalogForTests(entries: OpenRouterCatalogEntry[]): void {
  hydrateAttempted = true; // tests control the map; never snapshot-over it
  ingest(entries, "test-seed", new Date().toISOString());
}

export function clearOpenRouterCatalogForTests(): void {
  inMemory.clear();
  stats = { entries: 0, fetchedAt: null, source: "none", lastError: null };
  hydrateAttempted = false;
}

/** Case-insensitive catalog lookup; lazily hydrates from the snapshot once. */
export function lookupOpenRouterPricing(modelId: string): OpenRouterCatalogEntry | null {
  if (!modelId) return null;
  if (inMemory.size === 0 && !hydrateAttempted) hydrateFromSnapshotOnce();
  return inMemory.get(modelId.trim().toLowerCase()) ?? null;
}

/** All catalog ids (lowercase) — callers iterate for leaf-name aliasing. */
export function openRouterCatalogIds(): string[] {
  if (inMemory.size === 0 && !hydrateAttempted) hydrateFromSnapshotOnce();
  return [...inMemory.keys()];
}

export function openRouterPricingStats(): PricingCatalogStats {
  return { ...stats };
}

/** Snapshot provenance for UI honesty labels: ISO date of the loaded catalog, or null. */
export function openRouterSnapshotFetchedAt(): string | null {
  if (inMemory.size === 0 && !hydrateAttempted) hydrateFromSnapshotOnce();
  return stats.source === "snapshot" || stats.source === "network" ? stats.fetchedAt : null;
}
