import { ncodeAdapter, claudeCodeAdapter } from "./stream-json";
import { codexAdapter } from "./codex";
import { loadDescriptorAdapters } from "./loader";
import type { HarnessAdapter, HarnessId } from "./types";

const REGISTRY = new Map<HarnessId, HarnessAdapter>();
const ORDER: HarnessId[] = [];

function register(a: HarnessAdapter): void {
  if (!REGISTRY.has(a.id)) ORDER.push(a.id);
  REGISTRY.set(a.id, a);
}

register(ncodeAdapter);
register(claudeCodeAdapter);
register(codexAdapter);

for (const a of loadDescriptorAdapters()) register(a);

export const DEFAULT_HARNESS: HarnessId = "ncode";

export function getAdapter(id?: HarnessId): HarnessAdapter {
  if (id && REGISTRY.has(id)) return REGISTRY.get(id)!;
  return REGISTRY.get(DEFAULT_HARNESS)!;
}

export function listAdapters(): HarnessAdapter[] {
  return ORDER.map((id) => REGISTRY.get(id)!);
}

export function hasAdapter(id: HarnessId): boolean {
  return REGISTRY.has(id);
}
