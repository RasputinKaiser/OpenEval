"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, FileText, GitCompareArrows, LayoutDashboard, Radio, Plus, ShieldCheck, Terminal, Plug, Trophy, PanelLeftClose, PanelLeftOpen, Settings, Boxes, TrendingUp } from "lucide-react";
import clsx from "clsx";
import ThemeToggle from "./ThemeToggle";
import { cachedFetch } from "@/lib/cached-fetch";

interface NavItem { href: string; label: string; icon: typeof Activity }
interface NavSection { label: string | null; items: NavItem[] }

/**
 * Grouped by workflow: benchmarking your harnesses (Evaluate), understanding
 * your real day-to-day sessions (Observe), and plumbing (System).
 */
export const SECTIONS: NavSection[] = [
  {
    label: null,
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Evaluate",
    items: [
      { href: "/runs", label: "Runs", icon: Activity },
      { href: "/runs/leaderboard", label: "Leaderboard", icon: Trophy },
      { href: "/runs/compare", label: "Compare", icon: GitCompareArrows },
      { href: "/cases", label: "Cases", icon: FileText },
      { href: "/runs/new", label: "New Run", icon: Plus },
    ],
  },
  {
    label: "Observe",
    items: [
      { href: "/live", label: "Live", icon: Radio },
      { href: "/collection", label: "Collection", icon: Boxes },
      { href: "/collection/timeline", label: "Timeline", icon: TrendingUp },
      { href: "/accuracy", label: "Accuracy", icon: ShieldCheck },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/harnesses", label: "Harnesses", icon: Plug },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];


export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [runningCount, setRunningCount] = useState(0);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("openeval-sidebar-collapsed") === "1");
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem("openeval-sidebar-collapsed", collapsed ? "1" : "0"); } catch {}
  }, [collapsed]);

  useEffect(() => {
    let cancelled = false;
    async function checkRunning() {
      try {
        const d = await cachedFetch<{ runs: Array<{ status: string }> }>("/api/runs");
        const running = (d.runs ?? []).filter((r) => r.status === "running").length;
        if (!cancelled) setRunningCount(running);
      } catch {}
    }
    checkRunning();
    const interval = setInterval(checkRunning, 15000);
    function onVis() { if (document.visibilityState === "visible") checkRunning(); }
    document.addEventListener("visibilitychange", onVis);
    return () => { cancelled = true; clearInterval(interval); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  return (
    <aside className={clsx(
      "shrink-0 border-b border-bd bg-bg-subtle/80 backdrop-blur md:flex md:min-h-screen md:flex-col md:border-b-0 md:border-r transition-all",
      collapsed ? "md:w-14" : "md:w-60"
    )}>
      <div className="px-4 py-3 md:border-b md:border-bd md:py-5">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-md bg-gradient-to-br from-accent to-accent-soft grid place-items-center shrink-0">
            <Terminal className="size-4 text-white" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-tight">OpenEval</div>
              <div className="text-[10px] text-fg-dim uppercase tracking-wider">OpenEval Suite</div>
            </div>
          )}
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-1 md:flex-col md:space-y-0.5 md:overflow-visible md:p-2">
        {SECTIONS.map((section, si) => (
          <div key={section.label ?? si} className="flex gap-1 md:block md:space-y-0.5 shrink-0">
            {section.label && !collapsed && (
              <div className="hidden md:block px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest text-fg-dim select-none">{section.label}</div>
            )}
            {section.label && collapsed && <div className="hidden md:block mx-2 my-2 border-t border-bd-subtle" />}
            {section.items.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              const showBadge = item.href === "/runs" && runningCount > 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  className={clsx(
                    "relative flex shrink-0 items-center gap-2 rounded-md text-sm transition-colors",
                    collapsed ? "md:justify-center md:px-0 px-3 py-3 md:py-2" : "px-3 py-3 md:py-2",
                    active ? "bg-accent/15 text-accent-soft" : "text-fg-muted hover:bg-bg-elev hover:text-fg"
                  )}
                >
                  {active && <div className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent-soft" />}
                  <Icon className="size-4 shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                  {showBadge && (
                    <span className="absolute right-1 top-1.5 size-2 rounded-full bg-accent-soft animate-pulse" />
                  )}
                  {showBadge && !collapsed && (
                    <span className="ml-auto text-[10px] mono text-accent-soft bg-accent/15 rounded-full px-1.5 tabular-nums">{runningCount}</span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="hidden border-t border-bd p-3 md:flex md:items-center md:justify-between">
        {!collapsed && <div className="text-[10px] text-fg-dim mono">v0.1.0</div>}
        <div className="flex items-center gap-1">
          <ThemeToggle collapsed={collapsed} />
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="min-h-8 min-w-8 flex items-center justify-center rounded text-fg-dim hover:text-fg hover:bg-bg-elev transition-colors"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
        </div>
      </div>
    </aside>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/runs") return pathname === "/runs" || /^\/runs\/(?!new(?:\/|$)|compare(?:\/|$)|leaderboard(?:\/|$))[^/]+/.test(pathname);
  // /collection must not light up while its /collection/timeline sibling is active.
  if (href === "/collection") return pathname === "/collection";
  return pathname === href || pathname.startsWith(`${href}/`);
}