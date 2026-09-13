import { execFileSync } from "node:child_process";
import os from "node:os";

export interface DurationSummary {
  unit: "ms";
  sampleCount: number;
  median: number;
  p95: number;
  min: number;
  max: number;
  quantiles: { median: 0.5; p95: 0.95; method: "nearest-rank" };
}

export interface RuntimeMetadata {
  nodeVersion: string;
  execPath: string;
  platform: NodeJS.Platform;
  architecture: string;
  osRelease: string;
  cpuModel: string;
  gitCommit: string;
  gitDirty: boolean | "unavailable";
}

export interface ProcessMemorySnapshot {
  scope: "single benchmark process snapshot";
  rssBytes: number;
  heapUsedBytes: number;
  externalBytes: number;
}

/** Return the nearest-rank order statistic for a non-empty finite sample. */
export function nearestRank(values: readonly number[], quantile: number): number {
  if (values.length === 0) throw new Error("cannot calculate a percentile for an empty sample");
  if (!Number.isFinite(quantile) || quantile <= 0 || quantile > 1) throw new Error("quantile must be greater than 0 and at most 1");
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.some((value) => !Number.isFinite(value) || value < 0)) throw new Error("duration samples must be finite and non-negative");
  const rank = Math.max(1, Math.ceil(quantile * sorted.length));
  return sorted[rank - 1];
}

export function summarizeDurationSamples(values: readonly number[]): DurationSummary {
  if (values.length === 0) throw new Error("benchmark produced no measured samples");
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.some((value) => !Number.isFinite(value) || value < 0)) throw new Error("duration samples must be finite and non-negative");
  return {
    unit: "ms",
    sampleCount: sorted.length,
    median: nearestRank(sorted, 0.5),
    p95: nearestRank(sorted, 0.95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    quantiles: { median: 0.5, p95: 0.95, method: "nearest-rank" },
  };
}

function gitValue(args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

export function runtimeMetadata(): RuntimeMetadata {
  const status = gitValue(["status", "--porcelain"]);
  return {
    nodeVersion: process.version,
    execPath: process.execPath,
    platform: process.platform,
    architecture: process.arch,
    osRelease: os.release(),
    cpuModel: os.cpus()[0]?.model ?? "unavailable",
    gitCommit: gitValue(["rev-parse", "HEAD"]) ?? "unavailable",
    gitDirty: status === undefined ? "unavailable" : status.length > 0,
  };
}

export function processMemorySnapshot(): ProcessMemorySnapshot {
  const memory = process.memoryUsage();
  return {
    scope: "single benchmark process snapshot",
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    externalBytes: memory.external,
  };
}
