"use client";
import { useEffect, useState } from "react";
import { selectionParams, parseChartSelection, type ChartSelection } from "@/lib/chart-analysis";

type SavedView = { name: string; query: string };
const KEY = "openeval.analysis-views.v1";
export function SavedAnalysisViews({ selection }: { selection: ChartSelection }) {
  const [views, setViews] = useState<SavedView[]>([]), [name, setName] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => { try { const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]"); if (Array.isArray(stored)) {
      const valid = stored.filter((value): value is SavedView => typeof value?.name === "string" && value.name.trim().length > 0 && value.name.length <= 60 && typeof value?.query === "string" && value.query.length <= 4096 && !parseChartSelection(new URLSearchParams(value.query)).error);
      setViews([...new Map(valid.map(view => [view.name, { name: view.name, query: selectionParams(parseChartSelection(new URLSearchParams(view.query)).selection).toString() }])).values()].slice(-10));
    } } catch { setNotice("Saved views are unavailable in this browser."); } }, []);
  const save = (next: SavedView[]) => { try { localStorage.setItem(KEY, JSON.stringify(next)); setViews(next); setNotice("Saved in this browser."); } catch { setNotice("This browser could not save the view."); } };
  return <div className="mt-3 border-t border-bd-subtle pt-3"><div className="flex flex-wrap items-center gap-2"><label className="text-xs text-fg-muted" htmlFor="analysis-view-name">Save current filters</label><input id="analysis-view-name" className="analysis-input text-xs" placeholder="View name" maxLength={60} value={name} onChange={event => setName(event.target.value)} /><button type="button" className="analysis-control" disabled={!name.trim()} onClick={() => { save([...views.filter(view => view.name !== name.trim()), { name: name.trim(), query: selectionParams(selection).toString() }].slice(-10)); setName(""); }}>Save view</button></div>
    {views.length > 0 && <ul className="flex flex-wrap gap-2 mt-2">{views.map(view => <li key={view.name} className="flex items-center gap-1"><button type="button" className="analysis-control" onClick={() => { const url = new URL(window.location.href); url.search = view.query; window.history.pushState(null, "", url); window.dispatchEvent(new PopStateEvent("popstate")); }}>{view.name}</button><button type="button" className="analysis-control" aria-label={`Delete saved view ${view.name}`} onClick={() => save(views.filter(item => item.name !== view.name))}>×</button></li>)}</ul>}<p className="text-xs text-fg-muted mt-1" role="status">{notice || "Up to 10 named views, stored in this browser."}</p>
  </div>;
}
