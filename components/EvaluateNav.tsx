"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Activity, FileText, GitCompareArrows, ShieldCheck, Trophy, Play } from "lucide-react";

export const EVALUATE_ITEMS = [
  { href: "/runs", label: "Runs", description: "Track evaluations", icon: Activity },
  { href: "/runs/leaderboard", label: "Leaderboard", description: "Rank harnesses", icon: Trophy },
  { href: "/runs/compare", label: "Compare", description: "Find regressions", icon: GitCompareArrows },
  { href: "/cases", label: "Cases", description: "Curate the suite", icon: FileText },
  { href: "/runs/new", label: "New run", description: "Launch an experiment", icon: Play },
  { href: "/accuracy", label: "Accuracy", description: "Audit evidence", icon: ShieldCheck },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/runs") {
    return pathname === "/runs" || new RegExp("^/runs/(?!new(?:/|$)|compare(?:/|$)|leaderboard(?:/|$))").test(pathname);
  }
  if (href === "/runs/new" || href === "/runs/compare" || href === "/runs/leaderboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function EvaluateNav() {
  const pathname = usePathname();

  return (
    <section className="evaluate-nav mb-5 rounded-xl p-2" data-testid="evaluate-workflow-nav" aria-label="Evaluate workflow">
      <nav className="evaluate-nav__scroller flex min-w-0 gap-1.5 overflow-x-auto" aria-label="Evaluate pages">
        {EVALUATE_ITEMS.map((item) => {
          const selected = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={selected ? "page" : undefined}
              className={clsx(
                "evaluate-nav__item group flex min-w-[122px] shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                selected && "evaluate-nav__item--active",
              )}
            >
              <span className={clsx("evaluate-nav__icon", selected ? "text-accent-soft" : "") }>
                <Icon aria-hidden="true" className="size-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-medium">{item.label}</span>
                <span className="block truncate text-[10px] text-fg-dim">{item.description}</span>
              </span>
            </Link>
          );
        })}
      </nav>
      <p className="mt-1.5 px-2 text-[10px] text-fg-dim sm:hidden">Swipe to browse all six Evaluate surfaces</p>
    </section>
  );
}
