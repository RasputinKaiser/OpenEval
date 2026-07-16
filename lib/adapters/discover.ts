import { execFile } from "node:child_process";
import { listAdapters, hasAdapter, getAdapter, invalidateRegistry } from "./registry";
import { invalidateDescriptorCache } from "./loader";
import { resolveDescriptorBinInfo } from "./generic";
import type { AdapterCapabilities, HarnessAdapter } from "./types";
import type { RunnerContext } from "../types";
import { resolveDefaultModel } from "../models";

export type HarnessStatus = "available" | "not_found" | "error";

export interface ProbeCheck {
  ok: boolean;
  args: string[];
  output?: string;
  error?: string;
}

export interface DiscoveredHarness {
  id: string;
  label: string;
  binNames: string[];
  status: HarnessStatus;
  bin: string | null;
  source: "env" | "path" | "well_known" | "default" | "none";
  version: string | null;
  capabilities: AdapterCapabilities;
  imageFlag: string | null;
  probe?: { version: ProbeCheck; help?: ProbeCheck; imageFlagObserved: boolean | null };
  sampleCommand?: { bin: string; args: string[]; env: Record<string, string>; stdin?: string; model?: string };
  detail?: string;
}

/** Match the exact descriptor-declared option, including `--flag=VALUE`. */
export function probeFlagObserved(output: string, flag: string): boolean {
  const normalized = flag.trim();
  if (!normalized) return false;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[\\s,\\[])${escaped}(?=$|[\\s,=,\\]])`, "m").test(output);
}

let cache: DiscoveredHarness[] | null = null;

function sampleCtx(model?: string): RunnerContext {
  return {
    caseId: "<sample-case>",
    workdir: "/tmp/workdir",
    prompt: "Fix the bug in src/fizzbuzz.js",
    maxTurns: 25,
    timeoutMs: 300_000,
    permissionMode: "bypassPermissions",
    model,
    images: undefined,
    extraArgs: [],
  };
}

// Resolution lives in generic.ts so discovery and execution cannot disagree.
function resolveBin(adapter: HarnessAdapter): { bin: string | null; source: DiscoveredHarness["source"] } {
  const resolved = resolveDescriptorBinInfo(adapter.descriptor);
  return { bin: resolved.bin, source: resolved.source };
}

export function runProbe(bin: string, args: string[]): Promise<{ ok: boolean; output: string; error: string }> {
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
      imageFlag: adapter.descriptor.imageFlag ?? null,
      detail: `No binary found on PATH or well-known paths (looked for: ${adapter.binNames.join(", ")}).`,
    };
  }
  const versionArgs = adapter.versionArgs ?? ["--version"];
  const versionResult = await runProbe(bin, versionArgs);
  const helpArgs = adapter.descriptor.helpArgs;
  const helpResult = helpArgs.length ? await runProbe(bin, helpArgs) : null;
  const status: HarnessStatus = versionResult.ok && (helpResult == null || helpResult.ok) ? "available" : "error";
  const defaultModel = resolveDefaultModel(adapter.id).id;
  const sample = adapter.buildCommand(sampleCtx(defaultModel));
  const imageFlagObserved = helpResult && adapter.descriptor.imageFlag
    ? probeFlagObserved(helpResult.output, adapter.descriptor.imageFlag)
    : null;
  const failure = !versionResult.ok ? versionResult : helpResult && !helpResult.ok ? helpResult : null;
  return {
    id: adapter.id,
    label: adapter.label,
    binNames: adapter.binNames,
    status,
    bin,
    source,
    version: versionResult.ok ? versionResult.output.split("\n")[0].slice(0, 120) : null,
    capabilities: adapter.capabilities,
    imageFlag: adapter.descriptor.imageFlag ?? null,
    probe: {
      version: { args: versionArgs, ok: versionResult.ok, output: versionResult.output.slice(0, 4000) || undefined, error: versionResult.error || undefined },
      ...(helpResult ? { help: { args: helpArgs, ok: helpResult.ok, output: helpResult.output.slice(0, 4000) || undefined, error: helpResult.error || undefined } } : {}),
      imageFlagObserved,
    },
    sampleCommand: { bin: sample.bin, args: sample.args, env: sample.env, stdin: sample.stdin, ...(defaultModel ? { model: defaultModel } : {}) },
    detail: failure ? `Binary resolved to ${bin} but \`<bin> ${(failure === versionResult ? versionArgs : helpArgs).join(" ")}\` failed: ${failure.error || "no output"}` : undefined,
  };
}

export async function discoverHarnesses(force = false): Promise<DiscoveredHarness[]> {
  if (cache && !force) return cache;
  if (force) {
    invalidateDescriptorCache();
    invalidateRegistry();
  }
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
