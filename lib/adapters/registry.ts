import { BUILTIN_DESCRIPTORS } from "./builtin";
import { makeGenericAdapter } from "./generic";
import { loadDescriptorAdapters, getDescriptorIssues } from "./loader";
import { validateDescriptor, type DescriptorIssue } from "./schema";
import type { HarnessAdapter, HarnessId } from "./types";

/**
 * Every harness — bundled or user-defined — is a descriptor. User descriptors
 * in `harnesses/` override bundled ones with the same id. No harness is
 * privileged: the default is configurable, not hardcoded.
 */

let registry: Map<HarnessId, HarnessAdapter> | null = null;
let order: HarnessId[] = [];
let builtinIssues: DescriptorIssue[] = [];

function buildRegistry(): Map<HarnessId, HarnessAdapter> {
  if (registry) return registry;
  const map = new Map<HarnessId, HarnessAdapter>();
  order = [];
  builtinIssues = [];

  const register = (a: HarnessAdapter) => {
    if (!map.has(a.id)) order.push(a.id);
    map.set(a.id, a);
  };

  for (const raw of BUILTIN_DESCRIPTORS) {
    const { descriptor, issues } = validateDescriptor(raw, `builtin:${(raw as any)?.id ?? "?"}`);
    builtinIssues.push(...issues);
    if (descriptor) register(makeGenericAdapter(descriptor));
  }
  for (const a of loadDescriptorAdapters()) register(a);

  registry = map;
  return map;
}

export function invalidateRegistry(): void {
  registry = null;
}

export function getDefaultHarness(): HarnessId {
  const map = buildRegistry();
  const fromEnv = process.env.OPENEVAL_DEFAULT_HARNESS;
  if (fromEnv && map.has(fromEnv)) return fromEnv;
  return order[0];
}

export function getAdapter(id?: HarnessId): HarnessAdapter {
  const map = buildRegistry();
  if (id == null || id === "") return map.get(getDefaultHarness())!;
  const adapter = map.get(id);
  if (!adapter) {
    throw new Error(`Unknown harness "${id}". Registered harnesses: ${[...map.keys()].join(", ")}`);
  }
  return adapter;
}

export function listAdapters(): HarnessAdapter[] {
  const map = buildRegistry();
  return order.map((id) => map.get(id)!);
}

export function hasAdapter(id: HarnessId): boolean {
  return buildRegistry().has(id);
}

/** All descriptor problems — bundled and user-dir — for surfacing in UI/CLI. */
export function getAllDescriptorIssues(): DescriptorIssue[] {
  buildRegistry();
  return [...builtinIssues, ...getDescriptorIssues()];
}
