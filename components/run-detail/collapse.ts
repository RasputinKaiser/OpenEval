"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Per-run persisted collapse state for long run-detail sections. Keys are
 * stable section slugs ("graders", "transcript", …) so a reader's preference
 * carries across case selection within the same run.
 */

export type CollapsedMap = Record<string, boolean>;

export function collapseStorageKey(runId: string) {
  return `openeval.run-detail.collapsed.${runId}`;
}

/** Parse a stored collapse map defensively — junk in localStorage must never throw. */
export function parseCollapsedMap(raw: string | null): CollapsedMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: CollapsedMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "boolean") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function useCollapsedSections(runId: string) {
  const [collapsed, setCollapsed] = useState<CollapsedMap>({});

  // Load after mount: localStorage is unavailable during SSR and the default
  // (everything expanded) must match the server-rendered markup.
  useEffect(() => {
    try {
      setCollapsed(parseCollapsedMap(window.localStorage.getItem(collapseStorageKey(runId))));
    } catch {
      setCollapsed({});
    }
  }, [runId]);

  // Persisting outside the state updater keeps the updater pure (React may
  // replay updaters under StrictMode/concurrent rendering).
  const toggle = useCallback((section: string) => {
    const next = { ...collapsed, [section]: !collapsed[section] };
    setCollapsed(next);
    try {
      window.localStorage.setItem(collapseStorageKey(runId), JSON.stringify(next));
    } catch {
      // Storage full/blocked — state still toggles for this session.
    }
  }, [collapsed, runId]);

  return { collapsed, toggle };
}
