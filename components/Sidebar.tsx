"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, FileText, GitCompareArrows, LayoutDashboard, Radio, Plus, ShieldCheck, Terminal, Plug, Trophy, PanelLeftClose, PanelLeftOpen, Settings, Boxes, TrendingUp } from "lucide-react";
import clsx from "clsx";
import ThemeToggle from "./ThemeToggle";
import SupportLinks from "./SupportLinks";
import { cachedFetch } from "@/lib/cached-fetch";
import packageMetadata from "@/package.json";

interface NavItem { href: string; label: string; icon: typeof Activity }
interface NavSection { label: string | null; items: NavItem[] }

/**
 * Grouped by workflow: benchmarking your harnesses (Evaluate), understanding
 * your real day-to-day sessions (Observe), evaluation plumbing (Evaluate), and system plumbing (System).
 */
export const SECTIONS: NavSection[] = [
  {
    label: null,
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Observe",
    items: [
      { href: "/live", label: "Live", icon: Radio },
      { href: "/collection", label: "Collection", icon: Boxes },
      { href: "/collection/timeline", label: "Timeline", icon: TrendingUp },
    ],
  },
  {
      label: "Evaluate",
      items: [
        { href: "/runs", label: "Runs", icon: Activity },
        { href: "/runs/leaderboard", label: "Leaderboard", icon: Trophy },
        { href: "/runs/compare", label: "Compare", icon: GitCompareArrows },
        { href: "/cases", label: "Cases", icon: FileText },
        { href: "/runs/new", label: "New Run", icon: Plus },
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
      "sidebar-shell relative z-[130] hidden shrink-0 border-b border-bd backdrop-blur md:flex md:min-h-screen md:flex-col md:border-b-0 md:border-r transition-[width]",
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
              <div className="text-[10px] text-fg-dim uppercase tracking-[0.12em]">OpenEval Suite</div>
            </div>
          )}
        </div>
      </div>
      <nav aria-label="Primary" className="sidebar-nav flex gap-1 overflow-x-auto px-2 pb-2 md:flex-1 md:flex-col md:space-y-0.5 md:overflow-visible md:p-2">
        {SECTIONS.map((section, si) => (
          <div key={section.label ?? si} className="flex gap-1 md:block md:space-y-0.5 shrink-0">
            {section.label && !collapsed && (
              <div className="hidden px-3 pb-1 pt-3 text-[10px] uppercase tracking-widest text-fg-dim select-none md:block">{section.label}</div>
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
                  aria-label={collapsed ? item.label : undefined}
                  data-tooltip={collapsed ? item.label : undefined}
                  aria-current={active ? "page" : undefined}
                  className={clsx(
                    "sidebar-link relative flex shrink-0 items-center gap-2 rounded-md text-sm",
                    collapsed ? "md:justify-center md:px-0 px-3 py-3 md:py-2" : "px-3 py-3 md:py-2",
                    active && "sidebar-link--active",
                  )}
                >
                  {active && <div aria-hidden="true" className="sidebar-link__indicator absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded-full" />}
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  {/* Collapsed hides the label visually (md+) but keeps it for AT. */}
                  <span className={clsx(collapsed && "md:sr-only")}>{item.label}</span>
                  {showBadge && (
                    <span aria-hidden="true" className="sidebar-running-dot absolute right-1 top-1.5 size-2 rounded-full animate-pulse" />
                  )}
                  {showBadge && (
                    <span className="sr-only">{runningCount} running</span>
                  )}
                  {showBadge && !collapsed && (
                    <span aria-hidden="true" className="sidebar-running-count ml-auto rounded-full px-1.5 text-[10px] mono tabular-nums">{runningCount}</span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="hidden border-t border-bd md:block">
        <SupportLinks collapsed={collapsed} headingId="desktop-support-links-title" />
      </div>
      <div className="hidden border-t border-bd p-3 md:flex md:items-center md:justify-between">
        {!collapsed && (
          <a
            href={`https://github.com/RasputinKaiser/OpenEval/releases/tag/v${packageMetadata.version}`}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-fg-dim mono underline decoration-transparent underline-offset-2 transition-colors hover:text-accent-soft hover:decoration-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label={`OpenEval release v${packageMetadata.version}`}
            title={`OpenEval release v${packageMetadata.version}`}
            data-testid="release-version"
          >
            v{packageMetadata.version}
          </a>
        )}
        <div className="flex items-center gap-1">
          <ThemeToggle collapsed={collapsed} />
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="sidebar-collapse-button min-h-10 min-w-10 flex items-center justify-center rounded-md text-fg-dim transition-colors"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen aria-hidden="true" className="size-4" /> : <PanelLeftClose aria-hidden="true" className="size-4" />}
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
