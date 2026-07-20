"use client";

import type { ReactNode } from "react";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";

/**
 * Card with a toggleable header for long side-panel sections. Collapse state
 * is owned by the caller (persisted per run via useCollapsedSections).
 */
export default function CollapsibleCard({
  id,
  title,
  right,
  collapsed,
  onToggle,
  children,
}: {
  id?: string;
  title: ReactNode;
  right?: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div id={id} className="card overflow-hidden scroll-mt-3">
      <div className={clsx(
        "flex items-center justify-between gap-2 bg-bg-subtle/50 px-4 py-2.5",
        !collapsed && "border-b border-bd-subtle",
      )}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-medium hover:text-fg"
        >
          <ChevronRight className={clsx("size-3 shrink-0 text-fg-dim transition-transform", !collapsed && "rotate-90")} />
          <span className="min-w-0 truncate">{title}</span>
        </button>
        {right}
      </div>
      {!collapsed && children}
    </div>
  );
}
