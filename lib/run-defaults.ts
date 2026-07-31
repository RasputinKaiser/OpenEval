/** Per-browser form preferences consumed by NewRunClient (URL params win). */
export const RUN_DEFAULTS_KEY = "openeval-settings";

export const DEFAULT_RUN_SETTINGS = {
  defaultHarness: "",
  defaultModel: "",
  defaultParallel: 1,
  defaultSamples: 1,
};

export type RunSettings = typeof DEFAULT_RUN_SETTINGS;

function validStoredText(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return "";
  return value.trim();
}

export function boundedRunInt(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 8 ? number : 1;
}

/** Treat localStorage as untrusted input; old/corrupt values never reach run creation. */
export function sanitizeRunDefaults(value: unknown): RunSettings {
  const object = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    defaultHarness: validStoredText(object.defaultHarness, 120),
    defaultModel: validStoredText(object.defaultModel, 200),
    defaultParallel: strictStoredRunInt(object.defaultParallel),
    defaultSamples: strictStoredRunInt(object.defaultSamples),
  };
}

function strictStoredRunInt(value: unknown): number {
  if (typeof value === "number") return Number.isInteger(value) && value >= 1 && value <= 8 ? value : 1;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 8 ? parsed : 1;
  }
  return 1;
}

export function readRunDefaults(): RunSettings {
  try {
    const stored = localStorage.getItem(RUN_DEFAULTS_KEY);
    if (stored) return sanitizeRunDefaults(JSON.parse(stored));
  } catch {}
  return { ...DEFAULT_RUN_SETTINGS };
}
