/**
 * Shared display formatters. Compact by default — dashboards are for scanning —
 * with the exact value available via `title` tooltips (use the *Full variants).
 */

export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 2) + "B";
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1) + "M";
  if (abs >= 1_000) return (n / 1_000).toFixed(abs >= 10_000 ? 0 : 1) + "k";
  return String(Math.round(n));
}

export function fmtNumFull(n: number): string {
  return Number.isFinite(n) ? Math.round(n).toLocaleString() : "—";
}

export function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 10_000) return "$" + (n / 1000).toFixed(1) + "k";
  if (abs >= 100) return "$" + Math.round(n).toLocaleString();
  if (abs >= 1) return "$" + n.toFixed(2);
  return "$" + n.toFixed(4);
}

export function fmtUsdFull(n: number): string {
  return Number.isFinite(n) ? "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
}

export function fmtRel(ms: number | null | undefined): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
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
  return ms ? new Date(ms).toISOString().slice(0, 10) : "—";
}

export function fmtPct(x: number, digits = 0): string {
  return Number.isFinite(x) ? `${(x * 100).toFixed(digits)}%` : "—";
}

/** Signed delta, e.g. +0.12 / -3. */
export function fmtSigned(x: number, digits = 2): string {
  return (x >= 0 ? "+" : "") + x.toFixed(digits);
}
