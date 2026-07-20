import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasAdapter, getAdapter, getDefaultHarness, invalidateRegistry } from "../adapters/registry";
import { invalidateDescriptorCache } from "../adapters/loader";
import type { CollectionSourceSpec, LiveTraceFormat, LiveTraceSource } from "./types";

function defaultMaxDepth(format: LiveTraceFormat): number {
  return format === "codex-sessions" ? 5 : format === "claude-projects" ? 2 : 4;
}

export function specToSource(spec: CollectionSourceSpec): LiveTraceSource {
  return {
    id: spec.id,
    label: spec.label,
    status: "available",
    roots: spec.roots.map(expandHome),
    fields: spec.fields,
    format: spec.format,
    maxDepth: spec.maxDepth ?? defaultMaxDepth(spec.format),
    inferredModel: spec.inferredModel,
  };
}

export function defaultLiveLimitForHarness(harness?: string): number {
  const source = resolveLiveSource(harness);
  return source.format === "codex-sessions" ? 50 : 200;
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

/**
 * Live trace sources come from harness descriptors (`liveTrace`) — bundled and
 * user-defined alike. If the harness isn't in the registry yet (e.g. a
 * descriptor file was just added), the registry is refreshed once.
 */
export function resolveLiveSource(harness?: string): LiveTraceSource {
  const id = harness || getDefaultHarness();
  if (!hasAdapter(id)) {
    invalidateDescriptorCache();
    invalidateRegistry();
  }
  if (hasAdapter(id)) {
    const adapter = getAdapter(id);
    const lt = adapter.descriptor.liveTrace;
    if (lt) {
      const format: LiveTraceFormat = lt.format ?? "jsonl-dir";
      return {
        id: adapter.id,
        label: adapter.label,
        status: "available",
        roots: lt.roots.map(expandHome),
        fields: lt.fields ?? (format === "jsonl-dir" ? adapter.descriptor.fields : undefined),
        format,
        maxDepth: lt.maxDepth ?? (format === "codex-sessions" ? 5 : format === "claude-projects" ? 2 : 4),
        inferredModel: lt.inferredModel,
      };
    }
    return {
      id: adapter.id,
      label: adapter.label,
      status: "unavailable",
      roots: [],
      format: "jsonl-dir",
      maxDepth: 0,
      message: `${adapter.label} does not declare a liveTrace source yet.`,
    };
  }
  return {
    id,
    label: id,
    status: "unavailable",
    roots: [],
    format: "jsonl-dir",
    maxDepth: 0,
    message: `Unknown harness "${id}" does not have a registered live trace source.`,
  };
}

export function isPathInLiveSource(filePath: string, harness?: string): boolean {
  const source = resolveLiveSource(harness);
  if (source.status !== "available") return false;
  const resolved = path.resolve(filePath);
  return source.roots.some((root) => {
    const rootPath = path.resolve(root);
    const rel = path.relative(rootPath, resolved);
    const lexicalInside = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    if (!lexicalInside) return false;
    try {
      const realRoot = fs.realpathSync(rootPath);
      const realFile = fs.realpathSync(resolved);
      const realRel = path.relative(realRoot, realFile);
      return realRel === "" || (!realRel.startsWith("..") && !path.isAbsolute(realRel));
    } catch {
      // A pruned/missing transcript can still be opened as an archived-path
      // diagnostic. The later stat/parse step reports its disappearance.
      return true;
    }
  });
}

/** Expose the selected source format to server actions that open transcripts. */
export function liveTraceFormatForHarness(harness?: string): LiveTraceFormat {
  return resolveLiveSource(harness).format;
}
