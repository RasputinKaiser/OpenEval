import fs from "node:fs";
import path from "node:path";
import { HARNESS_DESC_DIR } from "../config";
import { makeGenericAdapter } from "./generic";
import type { HarnessAdapter } from "./types";

let loaded: HarnessAdapter[] | null = null;

export function loadDescriptorAdapters(): HarnessAdapter[] {
  if (loaded) return loaded;
  loaded = [];
  if (!fs.existsSync(HARNESS_DESC_DIR)) return loaded;
  const entries = fs.readdirSync(HARNESS_DESC_DIR).filter((f) => f.endsWith(".harness.json"));
  for (const f of entries) {
    try {
      const desc = JSON.parse(fs.readFileSync(path.join(HARNESS_DESC_DIR, f), "utf8"));
      if (!desc.id || !desc.label || !desc.binNames || !Array.isArray(desc.argTemplate)) {
        continue;
      }
      loaded.push(makeGenericAdapter(desc));
    } catch {}
  }
  return loaded;
}

export function invalidateDescriptorCache(): void {
  loaded = null;
}
