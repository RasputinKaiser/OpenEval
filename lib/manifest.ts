import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { probeHarness } from "./adapters/discover";
import { getAdapter } from "./adapters/registry";

export interface RunManifest {
  openevalVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  osRelease: string;
  createdAt: number;
  harness: { id: string; label: string; bin: string | null; version: string | null };
  model: string | null;
  repo: { gitSha: string | null; gitBranch: string | null; dirty: boolean | null };
  defaultsApplied: string[];
}

async function readOpenEvalVersion(): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "unknown";
  } catch {
    return "unknown";
  }
}

function execGit(args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd: process.cwd(), timeout: 5000, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      resolve(stdout.toString().trim());
    });
  });
}

export async function collectRunManifest(
  harnessId: string,
  model?: string,
  opts?: { harnessWasDefault?: boolean; modelWasDefault?: boolean }
): Promise<RunManifest> {
  const [openevalVersion, harnessProbe, gitSha, gitBranch, gitStatus] = await Promise.all([
    readOpenEvalVersion(),
    probeHarness(harnessId).catch(() => null),
    execGit(["rev-parse", "HEAD"]),
    execGit(["rev-parse", "--abbrev-ref", "HEAD"]),
    execGit(["status", "--porcelain"]),
  ]);
  const adapter = (() => {
    try {
      return getAdapter(harnessId);
    } catch {
      return null;
    }
  })();
  const defaultsApplied: string[] = [];
  if (opts?.harnessWasDefault) defaultsApplied.push(`harness:${harnessId} (registry default)`);
  if (opts?.modelWasDefault && model) defaultsApplied.push(`model:${model} (adapter default)`);

  return {
    openevalVersion,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    createdAt: Date.now(),
    harness: {
      id: harnessId,
      label: harnessProbe?.label ?? adapter?.label ?? harnessId,
      bin: harnessProbe?.bin ?? null,
      version: harnessProbe?.version ?? null,
    },
    model: model ?? null,
    repo: {
      gitSha,
      gitBranch,
      dirty: gitStatus == null ? null : gitStatus.length > 0,
    },
    defaultsApplied,
  };
}
