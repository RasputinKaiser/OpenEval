"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Bookmark, Check, Undo2, X } from "lucide-react";
import { selectionParams, parseChartSelection, type ChartSelection } from "@/lib/chart-analysis";
import { useChartSelection } from "@/lib/use-chart-selection";
import { readSavedViews, SAVED_VIEWS_KEY, type SavedView } from "@/lib/saved-analysis-views";

export function SavedAnalysisViews({ selection }: { selection: ChartSelection }) {
  const id = useId();
  const undoButton = useRef<HTMLButtonElement>(null), nameInput = useRef<HTMLInputElement>(null);
  const { setSelection } = useChartSelection();
  const [views, setViews] = useState<SavedView[]>([]), [name, setName] = useState(""), [notice, setNotice] = useState("");
  const [error, setError] = useState(false), [undo, setUndo] = useState<SavedView[] | null>(null);
  useEffect(() => { if (undo) undoButton.current?.focus(); }, [undo]);
  useEffect(() => {
    const load = () => { try { setViews(readSavedViews(localStorage.getItem(SAVED_VIEWS_KEY))); } catch { setError(true); setNotice("Saved views could not be read. Your current filters still work."); } };
    load();
    const sync = (event: StorageEvent) => { if (event.key === SAVED_VIEWS_KEY || event.key === null) { load(); setUndo(null); } };
    window.addEventListener("storage", sync); return () => window.removeEventListener("storage", sync);
  }, []);
  const save = (next: SavedView[], message: string) => {
    try { localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next)); setViews(next); setError(false); setNotice(message); return true; }
    catch { setError(true); setNotice("This browser could not save the change. Your view name and filters are still here; try again."); return false; }
  };
  return <div className="mt-3 border-t border-bd-subtle pt-3">
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); const trimmed = name.trim(); if (!trimmed) return; if (save([...views.filter(v => v.name !== trimmed), { name: trimmed, query: selectionParams(selection).toString() }].slice(-10), `Saved “${trimmed}” in this browser.`)) { setName(""); setUndo(null); } }}>
      <label className="text-xs text-fg-muted min-w-0" htmlFor={id}>Save current filters<input ref={nameInput} id={id} className="analysis-input block mt-1" placeholder="View name" maxLength={60} value={name} onChange={event => setName(event.target.value)} /></label>
      <button type="submit" className="analysis-control" disabled={!name.trim()}><Bookmark size={14} aria-hidden />Save view</button>
    </form>
    {views.length > 0 && <ul className="flex flex-wrap gap-2 mt-3">{views.map(view => <li key={view.name} className="saved-view flex min-w-0 max-w-full items-center gap-1"><button type="button" className="analysis-control min-w-0 max-w-full" title={view.name} onClick={() => { setSelection(parseChartSelection(new URLSearchParams(view.query)).selection); setError(false); setNotice(`Applied “${view.name}”.`); }}><span className="truncate" dir="auto">{view.name}</span></button><button type="button" className="analysis-control shrink-0" aria-label={`Delete saved view ${view.name}`} onClick={() => { if (save(views.filter(v => v.name !== view.name), `Deleted “${view.name}”.`)) setUndo(views); }}><X size={14} aria-hidden /></button></li>)}</ul>}
    <div className="mt-2 flex flex-wrap items-center gap-2"><p className={`text-xs ${error ? "text-err" : "text-fg-muted"}`} role="status">{notice && !error && <Check size={12} className="inline mr-1 text-ok" aria-hidden />}{notice || "Up to 10 named views, stored in this browser."}</p>{undo && <button ref={undoButton} type="button" className="analysis-control" onClick={() => { if (save(undo, "Saved view restored.")) { setUndo(null); nameInput.current?.focus(); } }}><Undo2 size={14} aria-hidden />Undo delete</button>}</div>
  </div>;
}
