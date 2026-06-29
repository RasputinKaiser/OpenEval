"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Search, ArrowRight, Activity, Radio, FileText, Plus, Trophy, GitCompareArrows, Plug, ShieldCheck, LayoutDashboard } from "lucide-react";

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  icon: any;
  href?: string;
  action?: () => void;
  group: "Navigation" | "Actions" | "Runs" | "Cases";
  keywords?: string;
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

export default function CommandPalette({ runs }: { runs: Array<{ id: string; name: string }> }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
        setQuery("");
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  void runs;
  const items = useMemo(() => {
    const runItems: CommandItem[] = runs.slice(0, 10).map((r) => ({
      id: `run-${r.id}`,
      label: r.name,
      hint: r.id,
      icon: Activity,
      href: `/runs/${r.id}`,
      group: "Runs" as const,
      keywords: r.id,
    }));
    const all = [...NAV_ITEMS, ...runItems];
    if (!query.trim()) return all;
    return all
      .map((item) => ({ item, score: fuzzyScore(query, item.label, item.keywords) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ item }) => item);
  }, [query, runs]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, items.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = items[selectedIdx];
        if (item?.href) router.push(item.href);
        if (item?.action) item.action();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, items, selectedIdx, router]);

  if (!open) return null;
  const grouped = items.reduce<Record<string, CommandItem[]>>((acc, item) => {
    (acc[item.group] ||= []).push(item);
    return acc;
  }, {});
  let runningIdx = 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
      <div className="absolute inset-0 bg-black/50 transition-opacity duration-150" onClick={() => setOpen(false)} />
      <div
        className="relative w-full max-w-xl mx-4 rounded-lg border border-bd bg-bg-subtle shadow-2xl overflow-hidden"
        style={{ animation: "menu-enter 120ms cubic-bezier(0.2, 0, 0, 1)" }}
      >
        <div className="flex items-center gap-3 border-b border-bd-subtle px-4 py-3">
          <Search className="size-4 text-fg-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands, runs, pages…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-fg-dim"
          />
          <kbd className="text-[10px] text-fg-dim rounded bg-bg-elev px-1.5 py-0.5">ESC</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-2">
          {Object.entries(grouped).map(([group, groupItems]) => (
            <div key={group}>
              <div className="px-4 py-1 text-[9px] uppercase tracking-wider text-fg-dim">{group}</div>
              {groupItems.map((item) => {
                const idx = runningIdx++;
                const active = idx === selectedIdx;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.id}
                    href={item.href ?? "#"}
                    onClick={() => setOpen(false)}
                    className={clsx(
                      "flex items-center gap-3 px-4 py-2 text-sm transition-colors",
                      active ? "bg-accent/10 text-accent-soft" : "text-fg hover:bg-bg-elev"
                    )}
                    onMouseEnter={() => setSelectedIdx(idx)}
                  >
                    <Icon className="size-4 shrink-0 text-fg-muted" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.hint && <span className="text-[10px] mono text-fg-dim">{item.hint}</span>}
                    {active && <ArrowRight className="size-3 text-accent-soft shrink-0" />}
                  </Link>
                );
              })}
            </div>
          ))}
          {items.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-fg-muted">No results for &ldquo;{query}&rdquo;</div>
          )}
        </div>
      </div>
    </div>
  );
}