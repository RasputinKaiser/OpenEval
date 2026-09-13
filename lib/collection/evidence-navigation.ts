export interface EvidenceNavigation {
  sourceId?: string;
  sessionId?: string;
  evidenceId?: string;
}

const MAX_SOURCE_ID = 160;
const MAX_SESSION_ID = 512;
const MAX_EVIDENCE_ID = 256;

function validValue(value: string | null, max: number): string | undefined {
  if (value === null || value === "") return undefined;
  if (value.length > max || /[\x00-\x1f]/.test(value)) return undefined;
  return value;
}

/** Read source/session/citation state without consuming unrelated page filters. */
export function parseEvidenceNavigation(params: URLSearchParams): EvidenceNavigation {
  const sourceId = validValue(params.get("sourceId"), MAX_SOURCE_ID);
  const sessionId = validValue(params.get("sessionId"), MAX_SESSION_ID);
  const evidenceId = validValue(params.get("evidenceId"), MAX_EVIDENCE_ID);
  return {
    ...(sourceId ? { sourceId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(evidenceId ? { evidenceId } : {}),
  };
}

export function setEvidenceNavigation(
  base: URLSearchParams,
  next: EvidenceNavigation,
): URLSearchParams {
  const params = new URLSearchParams(base);
  for (const key of ["sourceId", "sessionId", "evidenceId"] as const) {
    const value = next[key];
    if (value) params.set(key, value);
    else params.delete(key);
  }
  return params;
}

export function evidenceNavigationHref(
  path: string,
  navigation: EvidenceNavigation,
  base = new URLSearchParams(),
): string {
  const params = setEvidenceNavigation(base, navigation);
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}`;
}

export function evidenceSessionHref(
  path: string,
  sourceId: string,
  sessionId: string,
  base = new URLSearchParams(),
): string {
  return evidenceNavigationHref(path, { sourceId, sessionId }, base);
}

export function evidenceCitationHref(
  path: string,
  navigation: Pick<EvidenceNavigation, "sourceId" | "sessionId"> & { evidenceId: string },
  base = new URLSearchParams(),
): string {
  return evidenceNavigationHref(path, navigation, base);
}
