"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, FileText, GitCompareArrows, LayoutDashboard, Radio, Plus, ShieldCheck, Terminal, Plug, Trophy } from "lucide-react";
import clsx from "clsx";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/runs", label: "Runs", icon: Activity },
  { href: "/runs/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/runs/compare", label: "Compare", icon: GitCompareArrows },
  { href: "/harnesses", label: "Harnesses", icon: Plug },
  { href: "/accuracy", label: "Accuracy", icon: ShieldCheck },
  { href: "/live", label: "Live", icon: Radio },
  { href: "/cases", label: "Cases", icon: FileText },
  { href: "/runs/new", label: "New Run", icon: Plus },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="shrink-0 border-b border-bd bg-bg-subtle/80 backdrop-blur md:flex md:min-h-screen md:w-60 md:flex-col md:border-b-0 md:border-r">
      <div className="px-4 py-3 md:border-b md:border-bd md:py-5">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-md bg-gradient-to-br from-accent to-accent-soft grid place-items-center">
            <Terminal className="size-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">NEval</div>
            <div className="text-[10px] text-fg-dim uppercase tracking-wider">NEval Suite</div>
          </div>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-1 md:flex-col md:space-y-0.5 md:overflow-visible md:p-2">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex shrink-0 items-center gap-2 rounded-md px-3 py-3 md:py-2 text-sm transition-colors",
                active ? "bg-accent/15 text-accent-soft" : "text-fg-muted hover:bg-bg-elev hover:text-fg"
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="hidden border-t border-bd p-3 text-[10px] text-fg-dim md:block">
        <div className="mono">v0.1.0</div>
        <div className="mt-0.5">agents · graders · runs</div>
      </div>
    </aside>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/runs") return pathname === "/runs" || /^\/runs\/(?!new(?:\/|$)|compare(?:\/|$)|leaderboard(?:\/|$))[^/]+/.test(pathname);
  return pathname === href || pathname.startsWith(`${href}/`);
}
