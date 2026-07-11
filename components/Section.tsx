"use client";

import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";

/**
 * Shared page-section system: a sticky scrollspy jump-nav plus consistent
 * section headers. Pages wrap each region in <section id=… className="scroll-mt-16">
 * and list the same ids here. Assumes the page container uses p-4 md:p-6
 * (the nav bleeds to the container edge with matching negative margins).
 */

export function SectionHeader({ icon: Icon, title, desc, right }: { icon: LucideIcon; title: string; desc: string; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 mb-2.5">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="grid place-items-center size-6 rounded-md border border-bd bg-bg-elev shrink-0">
          <Icon className="size-3.5 text-accent-soft" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold leading-tight">{title}</h2>
          <p className="text-[11px] text-fg-dim leading-tight truncate">{desc}</p>
        </div>
      </div>
      {right && <div className="text-[11px] text-fg-dim mono tabular-nums shrink-0 pb-0.5">{right}</div>}
    </div>
  );
}

export function SectionNav({ sections, summary }: { sections: Array<{ id: string; label: string }>; summary?: string }) {
  const [active, setActive] = useState(sections[0]?.id);

  useEffect(() => {
    const onScroll = () => {
      let cur = sections[0]?.id;
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= 120) cur = s.id;
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8) {
        cur = sections[sections.length - 1]?.id;
      }
      setActive(cur);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [sections]);

  return (
    <nav
      aria-label="Page sections"
      className="sticky top-0 z-30 -mx-4 md:-mx-6 px-4 md:px-6 py-2 mb-5 border-b border-bd-subtle flex items-center gap-1 overflow-x-auto"
      style={{
        background: "color-mix(in srgb, var(--color-bg) 88%, transparent)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          aria-current={active === s.id ? "true" : undefined}
          onClick={(e) => {
            e.preventDefault();
            setActive(s.id); // immediate feedback — scroll events lag (or are throttled in background tabs)
            document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          className={clsx(
            "rounded-full px-2.5 py-1 text-[11px] whitespace-nowrap border transition-colors",
            active === s.id
              ? "border-accent/50 bg-accent/10 text-accent-soft"
              : "border-transparent text-fg-muted hover:text-fg hover:bg-bg-elev",
          )}
        >
          {s.label}
        </a>
      ))}
      {summary && <span className="ml-auto pl-3 text-[10px] text-fg-dim mono tabular-nums whitespace-nowrap hidden sm:block">{summary}</span>}
    </nav>
  );
}
