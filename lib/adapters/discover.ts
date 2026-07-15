import { execFile } from "node:child_process";
import { listAdapters, hasAdapter, getAdapter } from "./registry";
import { expandHomePath, isExecutable, resolveOnPath } from "./generic";
import type { AdapterCapabilities, HarnessAdapter } from "./types";
import type { RunnerContext } from "../types";

export type HarnessStatus = "available" | "not_found" | "error";

export interface DiscoveredHarness {
  id: string;
  label: string;
  binNames: string[];
  status: HarnessStatus;
  bin: string | null;
  source: "path" | "well_known" | "default" | "none";
  version: string | null;
  capabilities: AdapterCapabilities;
  sampleCommand?: { bin: string; args: string[] };
  detail?: string;
}

let cache: DiscoveredHarness[] | null = null;

function sampleCtx(): RunnerContext {
  return {
    caseId: "<sample-case>",
    workdir: "/tmp/workdir",
    prompt: "Fix the bug in src/fizzbuzz.js",
    maxTurns: 25,
    timeoutMs: 300_000,
    permissionMode: "bypassPermissions",
    model: undefined,
    extraArgs: [],
  };
}

// Resolution helpers (PATH walk, well-known paths) live in generic.ts so
// buildCommand spawns the exact binary discovery reports as "available".
function resolveBin(adapter: HarnessAdapter): { bin: string | null; source: DiscoveredHarness["source"] } {
  for (const name of adapter.binNames) {
    const onPath = resolveOnPath(name);
    if (onPath) return { bin: onPath, source: "path" };
  }
  for (const candidate of adapter.wellKnownPaths ?? []) {
    const expanded = expandHomePath(candidate);
    if (isExecutable(expanded)) return { bin: expanded, source: "well_known" };
  }
  return { bin: null, source: "none" };
}

function runVersion(bin: string, args: string[]): Promise<{ ok: boolean; output: string; error: string }> {
  return new Promise((resolve) => {
    const child = execFile(bin, args, { timeout: 6000, maxBuffer: 1 << 16 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, output: (stdout || "").toString().trim(), error: (err as any)?.message || String(err) });
      } else {
        const out = ((stdout || "") + (stderr || "")).toString().trim();
        resolve({ ok: true, output: out, error: "" });
      }
    });
    child.on("error", () => resolve({ ok: false, output: "", error: "spawn failed" }));
  });
}

async function probe(adapter: HarnessAdapter): Promise<DiscoveredHarness> {
  const { bin, source } = resolveBin(adapter);
  if (!bin) {
    return {
      id: adapter.id,
      label: adapter.label,
      binNames: adapter.binNames,
      status: "not_found",
      bin: null,
      source: "none",
      version: null,
      capabilities: adapter.capabilities,
      detail: `No binary found on PATH or well-known paths (looked for: ${adapter.binNames.join(", ")}).`,
    };
  }
  const versionArgs = adapter.versionArgs ?? ["--version"];
  const probe = await runVersion(bin, versionArgs);
  const status: HarnessStatus = probe.ok ? "available" : "error";
  const sample = adapter.buildCommand(sampleCtx());
  return {
    id: adapter.id,
    label: adapter.label,
    binNames: adapter.binNames,
    status,
    bin,
    source,
    version: probe.ok ? probe.output.split("\n")[0].slice(0, 120) : null,
    capabilities: adapter.capabilities,
    sampleCommand: { bin: sample.bin, args: sample.args },
    detail: probe.ok ? undefined : `Binary resolved to ${bin} but \`<bin> ${versionArgs.join(" ")}\` failed: ${probe.error || "no output"}`,
  };
}

export async function discoverHarnesses(force = false): Promise<DiscoveredHarness[]> {
  if (cache && !force) return cache;
  const results = await Promise.all(listAdapters().map(probe));
  cache = results;
  return results;
}

export async function probeHarness(id: string): Promise<DiscoveredHarness | null> {
  if (!hasAdapter(id)) return null;
  const adapter = getAdapter(id);
  const result = await probe(adapter);
  if (cache) {
    const idx = cache.findIndex((h) => h.id === id);
    if (idx >= 0) cache[idx] = result;
  }
  return result;
}
