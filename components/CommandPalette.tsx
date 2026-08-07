"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { Search, ArrowRight, Activity, Radio, FileText, Plus, Trophy, GitCompareArrows, Plug, ShieldCheck, LayoutDashboard, Boxes, TrendingUp, Settings, X } from "lucide-react";

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  icon: any;
  href?: string;
  action?: () => void;
  group: "Navigation" | "Actions" | "Runs" | "Cases" | "Sessions";
  keywords?: string;
}

export interface PaletteRun {
  id: string;
  name: string;
  status?: string;
}

export interface PaletteCase {
  id: string;
  name: string;
  category: string;
  description?: string;
  tags?: string[];
}

const NAV_ITEMS: CommandItem[] = [
  { id: "nav-home", label: "Dashboard", icon: LayoutDashboard, href: "/", group: "Navigation", keywords: "home overview" },
  { id: "nav-runs", label: "Runs", icon: Activity, href: "/runs", group: "Navigation", keywords: "evaluations history" },
  { id: "nav-live", label: "Live", icon: Radio, href: "/live", group: "Navigation", keywords: "sessions traces" },
  { id: "nav-cases", label: "Cases", icon: FileText, href: "/cases", group: "Navigation", keywords: "test library" },
  { id: "nav-new", label: "New Run", icon: Plus, href: "/runs/new", group: "Navigation", keywords: "start create" },
  { id: "nav-leaderboard", label: "Leaderboard", icon: Trophy, href: "/runs/leaderboard", group: "Navigation", keywords: "harness ranking compare" },
  { id: "nav-compare", label: "Compare", icon: GitCompareArrows, href: "/runs/compare", group: "Navigation", keywords: "diff" },
  { id: "nav-harnesses", label: "Harnesses", icon: Plug, href: "/harnesses", group: "Navigation", keywords: "cli adapters" },
  { id: "nav-accuracy", label: "Accuracy", icon: ShieldCheck, href: "/accuracy", group: "Navigation", keywords: "audit coverage" },
  { id: "nav-collection", label: "Collection", icon: Boxes, href: "/collection", group: "Navigation", keywords: "harnesses sessions archive search transcripts" },
  { id: "nav-timeline", label: "Timeline & comparisons", icon: TrendingUp, href: "/collection/timeline", group: "Navigation", keywords: "adoption skills plugins outcome judge" },
  { id: "nav-settings", label: "Settings", icon: Settings, href: "/settings", group: "Navigation", keywords: "config preferences" },
];

function fuzzyScore(query: string, text: string, keywords?: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const k = (keywords ?? "").toLowerCase();
  if (t.startsWith(q)) return 100;
  if (t.includes(q)) return 80;
  if (k.includes(q)) return 60;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length ? 40 : 0;
}

export default function CommandPalette({ runs, cases = [] }: { runs: PaletteRun[]; cases?: PaletteCase[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useFocusTrap(dialogRef, open);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape" && open) {
        // Claim the Escape so overlays underneath (e.g. MobileNav) stay open.
        e.preventDefault();
        e.stopImmediatePropagation();
        setOpen(false);
        setQuery("");
      }
    }
    window.addEventListener("keydown", handler);
    function openFromShell() {
      setOpen(true);
    }
    window.addEventListener("openeval:open-palette", openFromShell);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("openeval:open-palette", openFromShell);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIdx(0);
      // Initial focus is handled by the focus trap (input is data-autofocus).
    }
  }, [open]);

  // Keep the keyboard-selected option in view while arrowing through results.
  useEffect(() => {
    if (!open) return;
    document.getElementById(`palette-option-${selectedIdx}`)?.scrollIntoView({ block: "nearest" });
  }, [open, selectedIdx]);

  const items = useMemo(() => {
    // Keep the shell index bounded: runs come from the API's recent slice and
    // cases are projected to searchable metadata by SidebarNavClient. Session
    // text is intentionally delegated to Collection's full-text route below;
    // this palette never receives transcript rows or snippets.
    const runItems: CommandItem[] = runs.slice(0, 10).map((r) => ({
      id: `run-${r.id}`,
      label: r.name,
      hint: r.status ? `${r.status} · recent` : `${r.id} · recent`,
      icon: Activity,
      href: `/runs/${r.id}`,
      group: "Runs" as const,
      keywords: r.id,
    }));
    const caseItems: CommandItem[] = cases.slice(0, 80).map((c) => ({
      id: `case-${c.id}`,
      label: c.name,
      hint: c.category,
      icon: FileText,
      href: `/runs/new?caseIds=${encodeURIComponent(c.id)}`,
      group: "Cases" as const,
      keywords: [c.id, c.category, c.description, ...(c.tags ?? [])].filter(Boolean).join(" "),
    }));
    const sessionSearch = query.trim().length >= 2
      ? [{
        id: "session-search",
        label: `Search all session evidence for “${query.trim()}”`,
        hint: "Collection · full text",
        icon: Search,
        href: `/collection?q=${encodeURIComponent(query.trim())}`,
        group: "Sessions" as const,
        keywords: `${query} session evidence collection full text`,
      } satisfies CommandItem]
      : [];
    const all = [...NAV_ITEMS, ...runItems, ...caseItems, ...sessionSearch];
    if (!query.trim()) return all;
    return all
      .map((item) => ({ item, score: fuzzyScore(query, item.label, item.keywords) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ item }) => item);
  }, [cases, query, runs]);

  // Group for display, then flatten back so the keyboard index, the rendered
  // option ids, and aria-activedescendant all agree on ONE order. Using the
  // score-sorted flat list for the keyboard while rendering group-by-group
  // made Enter act on a different item than the highlighted one whenever
  // scores interleaved groups.
  const { grouped, ordered } = useMemo(() => {
    const grouped = items.reduce<Record<string, CommandItem[]>>((acc, item) => {
      (acc[item.group] ||= []).push(item);
      return acc;
    }, {});
    return { grouped, ordered: Object.values(grouped).flat() };
  }, [items]);

  const highlightedIdx = ordered.length > 0
    ? Math.min(Math.max(selectedIdx, 0), ordered.length - 1)
    : 0;

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (!open) return;
      if (ordered.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, Math.max(ordered.length - 1, 0)));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = ordered[highlightedIdx];
        if (item?.href) router.push(item.href);
        if (item?.action) item.action();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [highlightedIdx, open, ordered, router]);

  if (!open) return null;
  let runningIdx = 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
      <div aria-hidden="true" className="absolute inset-0 bg-black/50 transition-opacity duration-150" onClick={() => setOpen(false)} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        className="relative w-full max-w-xl mx-4 rounded-lg border border-bd bg-bg-subtle shadow-2xl overflow-hidden anim-menu-enter"
      >
        <h2 id="command-palette-title" className="sr-only">Command palette</h2>
        <div className="flex items-center gap-3 border-b border-bd-subtle px-4 py-3">
          <Search aria-hidden="true" className="size-4 text-fg-muted shrink-0" />
          <input
            ref={inputRef}
            data-autofocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages, recent runs, cases, or session evidence…"
            aria-label="Search commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-listbox"
            aria-autocomplete="list"
            aria-activedescendant={ordered.length > 0 ? `palette-option-${highlightedIdx}` : undefined}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-fg-dim"
          />
          <kbd aria-hidden="true" className="text-[10px] text-fg-dim rounded bg-bg-elev px-1.5 py-0.5">ESC</kbd>
          <button
            type="button"
            onClick={() => { setOpen(false); setQuery(""); }}
            aria-label="Close command palette"
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-bg-elev hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
        <div aria-live="polite" className="sr-only">
          {ordered.length === 0 ? `No results for ${query}` : `${ordered.length} result${ordered.length === 1 ? "" : "s"}`}
        </div>
        <div id="palette-listbox" role="listbox" aria-label="Commands" className="max-h-[50vh] overflow-y-auto py-2">
          {Object.entries(grouped).map(([group, groupItems]) => (
            <div key={group} role="group" aria-labelledby={`palette-group-${group}`}>
              <div id={`palette-group-${group}`} role="presentation" className="px-4 py-1 text-[9px] uppercase tracking-wider text-fg-dim">{group}</div>
              {groupItems.map((item) => {
                const idx = runningIdx++;
                const active = idx === highlightedIdx;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.id}
                    id={`palette-option-${idx}`}
                    role="option"
                    aria-selected={active}
                    tabIndex={-1}
                    href={item.href ?? "#"}
                    onClick={() => setOpen(false)}
                    className={clsx(
                      "flex items-center gap-3 px-4 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                      active ? "bg-accent/10 text-accent-soft ring-1 ring-inset ring-accent/60" : "text-fg hover:bg-bg-elev"
                    )}
                    onMouseEnter={() => setSelectedIdx(idx)}
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.hint && <span className="text-[10px] mono text-fg-dim">{item.hint}</span>}
                    {active && <ArrowRight aria-hidden="true" className="size-3 text-accent-soft shrink-0" />}
                  </Link>
                );
              })}
            </div>
          ))}
          {ordered.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-fg-muted">No results for &ldquo;{query}&rdquo;</div>
          )}
        </div>
        <div className="border-t border-bd-subtle px-4 py-2 text-[10px] leading-4 text-fg-dim">
          Pages: all routes · Runs: latest 10 · Cases: metadata index · Sessions: full-text search opens Collection
        </div>
      </div>
    </div>
  );
}
