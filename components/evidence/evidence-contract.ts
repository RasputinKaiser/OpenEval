/**
 * Serializable evidence metadata shared by server snapshots and client
 * surfaces.  This file deliberately has no React or server imports so the
 * contract can cross the server/client boundary without pulling transcript
 * readers into a browser bundle.
 */

export type EvidenceState = "fresh" | "stale" | "partial" | "refreshing" | "error";

export interface EvidenceCoverage {
  numerator: number;
  denominator: number;
  ratio: number;
}

export type EvidenceCoverageMap = Record<string, EvidenceCoverage>;
export type EvidenceDenominatorMap = Record<string, number>;

export interface EvidenceProvenance {
  source: string;
  kind: "snapshot" | "derived" | "audit" | "unknown";
  scope: string;
  /** Short metadata-only notes. Never place transcript bodies here. */
  notes?: string[];
}

export type EvidenceRetryReason = "initial" | "stale" | "partial" | "error" | "refreshing" | "none";

export interface EvidenceRetry {
  available: boolean;
  action: "refresh" | "retry" | "none";
  reason: EvidenceRetryReason;
  attempts: number;
  retryAfterMs?: number;
}

export interface EvidenceContract {
  /** Null means no last-good value has been generated yet. */
  generatedAt: number | null;
  fresh: boolean;
  stale: boolean;
  partial: boolean;
  refreshing: boolean;
  /** Refresh/load error only; a product-level fail/unknown is not a refresh error. */
  error: string | null;
  coverage: EvidenceCoverageMap;
  denominators: EvidenceDenominatorMap;
  provenance: EvidenceProvenance;
  retry: EvidenceRetry;
  state: EvidenceState;
}

export interface EvidenceDescriptor {
  partial?: boolean;
  coverage?: EvidenceCoverageMap;
  denominators?: EvidenceDenominatorMap;
  provenance?: EvidenceProvenance;
}

export interface EvidenceContractOptions extends EvidenceDescriptor {
  generatedAt?: number | null;
  stale?: boolean;
  refreshing?: boolean;
  error?: string | null;
  attempts?: number;
  retryAfterMs?: number;
  retry?: Partial<EvidenceRetry>;
  /** A non-cacheable result is transient even when its loader did not say partial. */
  transient?: boolean;
}

function safeNumber(value: number | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function normalizeCoverageMap(coverage: EvidenceCoverageMap | undefined): EvidenceCoverageMap {
  if (!coverage) return {};
  return Object.fromEntries(Object.entries(coverage).map(([key, value]) => {
    const numerator = safeNumber(value?.numerator);
    const denominator = safeNumber(value?.denominator);
    return [key, {
      numerator,
      denominator,
      ratio: denominator > 0 ? Math.min(1, numerator / denominator) : 0,
    }];
  }));
}

function normalizeDenominators(denominators: EvidenceDenominatorMap | undefined): EvidenceDenominatorMap {
  if (!denominators) return {};
  return Object.fromEntries(Object.entries(denominators).map(([key, value]) => [key, safeNumber(value)]));
}

const UNKNOWN_PROVENANCE: EvidenceProvenance = {
  source: "unknown",
  kind: "unknown",
  scope: "unavailable",
};

/** Build one honest status shape for snapshots, derived reports, and audits. */
export function createEvidenceContract(options: EvidenceContractOptions = {}): EvidenceContract {
  const partial = options.partial === true || options.transient === true;
  const stale = options.stale === true;
  const refreshing = options.refreshing === true;
  const error = options.error ?? null;
  const generatedAt = options.generatedAt ?? null;
  const attempts = Math.max(0, Math.trunc(options.attempts ?? 0));
  const retryAfterMs = options.retryAfterMs !== undefined
    ? Math.max(0, Math.trunc(options.retryAfterMs))
    : undefined;

  const reason: EvidenceRetryReason = error
    ? "error"
    : refreshing
      ? "refreshing"
      : partial
        ? "partial"
        : stale
          ? "stale"
          : generatedAt === null
            ? "initial"
            : "none";
  const defaultRetry: EvidenceRetry = {
    available: reason === "error" || reason === "partial" || reason === "stale",
    action: reason === "error" || reason === "partial" ? "retry" : reason === "stale" ? "refresh" : "none",
    reason,
    attempts,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
  const retry: EvidenceRetry = {
    ...defaultRetry,
    ...options.retry,
    attempts: Math.max(0, Math.trunc(options.retry?.attempts ?? defaultRetry.attempts)),
    ...(options.retry?.retryAfterMs === undefined && retryAfterMs === undefined
      ? {}
      : { retryAfterMs: Math.max(0, Math.trunc(options.retry?.retryAfterMs ?? retryAfterMs ?? 0)) }),
  };

  const state: EvidenceState = error
    ? "error"
    : refreshing
      ? "refreshing"
      : partial
        ? "partial"
        : stale
          ? "stale"
          : "fresh";

  return {
    generatedAt,
    fresh: generatedAt !== null && !stale && !partial && !error,
    stale,
    partial,
    refreshing,
    error,
    coverage: normalizeCoverageMap(options.coverage),
    denominators: normalizeDenominators(options.denominators),
    provenance: options.provenance ?? UNKNOWN_PROVENANCE,
    retry,
    state,
  };
}

export function evidenceCoverage(numerator: number, denominator: number): EvidenceCoverage {
  const safeNumerator = safeNumber(numerator);
  const safeDenominator = safeNumber(denominator);
  return {
    numerator: safeNumerator,
    denominator: safeDenominator,
    ratio: safeDenominator > 0 ? Math.min(1, safeNumerator / safeDenominator) : 0,
  };
}
