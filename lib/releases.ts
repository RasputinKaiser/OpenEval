export const RELEASES_URL = "https://github.com/RasputinKaiser/OpenEval/releases";

export function stableVersion(value: unknown): number[] | null {
  if (typeof value !== "string" || !/^v?\d+\.\d+\.\d+$/.test(value)) return null;
  const parts = value.replace(/^v/, "").split(".").map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

export function isNewerRelease(tag: string, installed: string): boolean {
  const next = stableVersion(tag), current = stableVersion(installed);
  if (!next || !current) return false;
  for (let i = 0; i < 3; i++) {
    if (next[i] !== current[i]) return next[i] > current[i];
  }
  return false;
}

export function readRelease(value: unknown, installed: string) {
  if (!value || typeof value !== "object") throw new Error("Invalid release response");
  const release = value as Record<string, unknown>;
  if (!stableVersion(release.tag_name) || release.draft !== false || release.prerelease !== false) {
    throw new Error("No supported stable release was returned");
  }
  const tag = release.tag_name as string;
  return { installed, latest: tag, available: isNewerRelease(tag, installed),
    url: `${RELEASES_URL}/tag/${encodeURIComponent(tag)}` };
}
