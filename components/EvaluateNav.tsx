"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Activity, FileText, GitCompareArrows, ShieldCheck, Trophy, Play } from "lucide-react";

export const EVALUATE_ITEMS = [
  { href: "/runs", label: "Runs", description: "Track evaluations", icon: Activity },
  { href: "/runs/leaderboard", label: "Leaderboard", description: "Review standings", icon: Trophy },
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
      <nav className="evaluate-nav__scroller grid min-w-0 grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-6" aria-label="Evaluate pages">
        {EVALUATE_ITEMS.map((item) => {
          const selected = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={selected ? "page" : undefined}
              className={clsx(
                "evaluate-nav__item group flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                selected && "evaluate-nav__item--active",
              )}
            >
              <span className={clsx("evaluate-nav__icon", selected ? "text-accent-soft" : "") }>
                <Icon aria-hidden="true" className="size-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="block text-xs leading-4 text-fg-dim">{item.description}</span>
              </span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-bd px-2 pt-2 text-xs leading-5">
        <p className="text-fg-muted flex-1 basis-64">{pathname.startsWith("/accuracy")
          ? "Check grader calibration and evidence coverage before trusting a score."
          : pathname.startsWith("/runs/leaderboard")
            ? "Standings describe recorded runs. Compare matching cases to investigate differences."
            : pathname.startsWith("/runs/compare")
              ? "Compare the same cases, then open the evidence behind a regression."
              : pathname.startsWith("/runs/new")
                ? "Choose a suite, review the runner and limits, then start your evaluation."
                : pathname.startsWith("/cases")
                  ? "Inspect the task and grading contract before adding a case to a run."
                  : "Open a run for case results, grader findings, and recorded artifacts."}</p>
        <Link href="/cases/playground" className="analysis-control min-h-11">Interactive playground →</Link>
      </div>
    </section>
  );
}
