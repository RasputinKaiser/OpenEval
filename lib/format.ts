/**
 * Shared display formatters. Compact by default — dashboards are for scanning —
 * with the exact value available via `title` tooltips (use the *Full variants).
 */

/** Human-readable byte size — "1.11 GB", not "1.11BB". */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u += 1; }
  const digits = u === 0 ? 0 : v >= 100 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[u]}`;
}

/** Exact integer with locale grouping — for denominators and counts where "3.3k" lies. */
export function fmtInt(n: number): string {
  return Number.isFinite(n) ? INT_FORMATTER.format(Math.round(n)) : "—";
}

export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 2) + "B";
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1) + "M";
  if (abs >= 1_000) return (n / 1_000).toFixed(abs >= 10_000 ? 0 : 1) + "k";
  return String(Math.round(n));
}

export function fmtNumFull(n: number): string {
  return fmtInt(n);
}

export function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 10_000) return "$" + (n / 1000).toFixed(1) + "k";
  if (abs >= 100) return "$" + Math.round(n).toLocaleString();
  if (abs >= 1) return "$" + n.toFixed(2);
  // Zero needs no sub-cent precision; tiny estimates keep 4 decimals.
  if (n === 0) return "$0.00";
  return "$" + n.toFixed(4);
}

export function fmtUsdFull(n: number): string {
  return Number.isFinite(n) ? "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
}

/** Explicit date/time presentation for client-only updates after hydration. */
export const DISPLAY_LOCALE = "en-US";
export const DISPLAY_TIME_ZONE = "UTC";

const INT_FORMATTER = new Intl.NumberFormat(DISPLAY_LOCALE);

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  timeZone: DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const TIME_FORMATTER = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  timeZone: DISPLAY_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

/** Stable absolute fallback safe to use in server-rendered markup. */
export function fmtStableDateTime(ms: number | null | undefined): string {
  return typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : "—";
}

/** Human-readable date/time with an explicit locale and timezone. */
export function fmtDateTime(ms: number | null | undefined): string {
  return typeof ms === "number" && Number.isFinite(ms) ? DATE_TIME_FORMATTER.format(new Date(ms)) : "—";
}

/** Human-readable time with an explicit locale and timezone. */
export function fmtTime(ms: number | null | undefined): string {
  return typeof ms === "number" && Number.isFinite(ms) ? TIME_FORMATTER.format(new Date(ms)) : "—";
}

export function fmtRel(ms: number | null | undefined, nowMs = Date.now()): string {
  if (!ms) return "—";
  const diff = nowMs - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + "m ago";
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + "h ago";
  if (diff < 30 * 86_400_000) return Math.floor(diff / 86_400_000) + "d ago";
  return new Date(ms).toISOString().slice(0, 10);
}

export function fmtDuration(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ${Math.floor((ms % 60_000) / 1000)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function fmtDate(ms: number | null | undefined): string {
  return typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : "—";
}

export function fmtPct(x: number, digits = 0): string {
  return Number.isFinite(x) ? `${(x * 100).toFixed(digits)}%` : "—";
}

/** Signed delta, e.g. +0.12 / -3. */
export function fmtSigned(x: number, digits = 2): string {
  return Number.isFinite(x) ? (x >= 0 ? "+" : "") + x.toFixed(digits) : "—";
}

/** Monday-first weekday labels — matches the collection heatmap's row order. */
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
