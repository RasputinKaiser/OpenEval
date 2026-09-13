import { parseChartSelection, selectionParams } from "./chart-analysis";
export type SavedView = { name: string; query: string };
export const SAVED_VIEWS_KEY = "openeval.analysis-views.v1";
export function readSavedViews(raw: string | null): SavedView[] {
  if (raw && raw.length > 50_000) throw new Error("Saved views exceed the supported storage limit.");
  const values: unknown = JSON.parse(raw ?? "[]");
  if (!Array.isArray(values)) throw new Error("Saved views have an unreadable format.");
  const valid = values.filter((v): v is SavedView => v !== null && typeof v === "object" && typeof v.name === "string" && v.name.trim().length > 0 && v.name.length <= 60 && typeof v.query === "string" && v.query.length <= 4096 && !parseChartSelection(new URLSearchParams(v.query)).error);
  return [...new Map(valid.map(v => [v.name.trim(), { name: v.name.trim(), query: selectionParams(parseChartSelection(new URLSearchParams(v.query)).selection).toString() }])).values()].slice(-10);
}
