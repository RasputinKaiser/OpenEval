import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config";

export interface AppSettings {
  /** Empty means follow environment variables and the built-in fallback chain. */
  judgeSource: string;
  /** Empty means use the selected source's safe default model. */
  judgeModel: string;
}
const DEFAULT_SETTINGS: AppSettings = { judgeSource: "", judgeModel: "" };
const SETTINGS_PATH = path.join(ROOT, "data", "settings.json");

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readAppSettings(): AppSettings {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_SETTINGS };
    const raw = parsed as Record<string, unknown>;
    return {
      judgeSource: normalizeString(raw.judgeSource),
      judgeModel: normalizeString(raw.judgeModel),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveAppSettings(next: Partial<AppSettings>): AppSettings {
  const settings: AppSettings = {
    judgeSource: normalizeString(next.judgeSource),
    judgeModel: normalizeString(next.judgeModel),
  };
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  const tempPath = `${SETTINGS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, SETTINGS_PATH);
  return settings;
}
