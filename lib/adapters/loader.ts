import fs from "node:fs";
import path from "node:path";
import { HARNESS_DESC_DIR } from "../config";
import { makeGenericAdapter } from "./generic";
import { validateDescriptor, type DescriptorIssue } from "./schema";
import type { HarnessAdapter } from "./types";

export interface DescriptorLoadResult {
  adapters: HarnessAdapter[];
  issues: DescriptorIssue[];
}

let loaded: DescriptorLoadResult | null = null;

/**
 * Load user-defined harness descriptors from `harnesses/*.harness.json`.
 * Invalid descriptors are never silently dropped — every problem is reported
 * as an issue that surfaces in the /harnesses page, the API, and the CLI.
 */
export function loadDescriptors(): DescriptorLoadResult {
  if (loaded) return loaded;
  const adapters: HarnessAdapter[] = [];
  const issues: DescriptorIssue[] = [];
  if (fs.existsSync(HARNESS_DESC_DIR)) {
    const entries = fs.readdirSync(HARNESS_DESC_DIR).filter((f) => f.endsWith(".harness.json")).sort();
    for (const f of entries) {
      const source = path.join("harnesses", f);
      let raw: unknown;
      try {
        raw = JSON.parse(fs.readFileSync(path.join(HARNESS_DESC_DIR, f), "utf8"));
      } catch (e) {
        issues.push({ source, message: `invalid JSON: ${e instanceof Error ? e.message : String(e)}` });
        continue;
      }
      const { descriptor, issues: descIssues } = validateDescriptor(raw, source);
      issues.push(...descIssues);
      if (descriptor) adapters.push(makeGenericAdapter(descriptor));
    }
  }
  loaded = { adapters, issues };
  return loaded;
}

export function loadDescriptorAdapters(): HarnessAdapter[] {
  return loadDescriptors().adapters;
}

export function getDescriptorIssues(): DescriptorIssue[] {
  return loadDescriptors().issues;
}

export function invalidateDescriptorCache(): void {
  loaded = null;
}
