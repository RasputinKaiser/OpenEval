"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, FileText, GitCompareArrows, LayoutDashboard, Radio, Plus, ShieldCheck, Terminal } from "lucide-react";
import clsx from "clsx";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/runs", label: "Runs", icon: Activity },
  { href: "/runs/compare", label: "Compare", icon: GitCompareArrows },
  { href: "/accuracy", label: "Accuracy", icon: ShieldCheck },
  { href: "/live", label: "Live", icon: Radio },
  { href: "/cases", label: "Cases", icon: FileText },
  { href: "/runs/new", label: "New Run", icon: Plus },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-60 shrink-0 border-r border-bd bg-bg-subtle/60 backdrop-blur flex flex-col">
      <div className="px-4 py-5 border-b border-bd">
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
      <nav className="flex-1 p-2 space-y-0.5">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
                active ? "bg-accent/15 text-accent-soft" : "text-fg-muted hover:bg-bg-elev hover:text-fg"
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-bd text-[10px] text-fg-dim">
        <div className="mono">v0.1.0</div>
        <div className="mt-0.5">agents · graders · runs</div>
      </div>
    </aside>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/runs") return pathname === "/runs" || /^\/runs\/(?!new(?:\/|$)|compare(?:\/|$))[^/]+/.test(pathname);
  return pathname === href || pathname.startsWith(`${href}/`);
}
