"use client";

import { useCallback, useEffect, useState } from "react";
import { parseChartSelection, selectionParams, type ChartSelection } from "./chart-analysis";
const CHANGE = "openeval:chart-selection";

/** Shared URL selection; push on deliberate changes and restore on Back/Forward. */
export function useChartSelection() {
  const [selection, setState] = useState<ChartSelection>({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    const read = () => {
      const result = parseChartSelection(new URLSearchParams(window.location.search));
      setState(result.selection); setError(result.error); setReady(true);
    };
    read();
    window.addEventListener("popstate", read);
    window.addEventListener(CHANGE, read);
    return () => { window.removeEventListener("popstate", read); window.removeEventListener(CHANGE, read); };
  }, []);
  const setSelection = useCallback((next: ChartSelection | ((previous: ChartSelection) => ChartSelection)) => {
    const previous = parseChartSelection(new URLSearchParams(window.location.search)).selection;
    const value = typeof next === "function" ? next(previous) : next;
    const params = selectionParams(value, new URLSearchParams(window.location.search));
    const parsed = parseChartSelection(params);
    if (parsed.error) { setError(parsed.error); return; }
    const query = params.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.pushState(window.history.state, "", url);
    window.dispatchEvent(new Event(CHANGE));
  }, []);
  return { selection, setSelection, ready, error };
}
