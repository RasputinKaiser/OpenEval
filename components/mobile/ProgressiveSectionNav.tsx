"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";

export interface ProgressiveSection {
  id: string;
  label: string;
  description?: string;
}

export type ProgressiveSectionId = string | "all";

function scrollSectionIntoView(sectionId: string): void {
  // React commits the newly visible mobile panel before the next frame.
  window.requestAnimationFrame(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(sectionId)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  });
}

/**
 * Task-focused section disclosure shared by the analysis surfaces. A selected
 * panel keeps every viewport task-sized; the explicit All choice remains the
 * full-report fallback for scanning and print.
 */
export function useProgressiveSection(
  sections: ProgressiveSection[],
  initialSection: ProgressiveSectionId = sections[0]?.id ?? "all",
) {
  const [activeSection, setActiveSection] = useState<ProgressiveSectionId>(initialSection);
  const beforePrintSection = useRef<ProgressiveSectionId | null>(null);

  useEffect(() => {
    function syncFromLocation() {
      const url = new URL(window.location.href);
      const hash = window.location.hash.slice(1);
      const fromUrl = hash || url.searchParams.get("section");
      if (fromUrl === "all" || (fromUrl && sections.some((section) => section.id === fromUrl))) {
        setActiveSection(fromUrl as ProgressiveSectionId);
        if (fromUrl !== "all") scrollSectionIntoView(fromUrl);
        return;
      }
      if (fromUrl) setActiveSection("all");
    }
    syncFromLocation();
    window.addEventListener("popstate", syncFromLocation);
    window.addEventListener("hashchange", syncFromLocation);
    return () => {
      window.removeEventListener("popstate", syncFromLocation);
      window.removeEventListener("hashchange", syncFromLocation);
    };
  }, [sections]);

  useEffect(() => {
    if (activeSection !== "all" && !sections.some((section) => section.id === activeSection)) {
      setActiveSection("all");
    }
  }, [activeSection, sections]);

  useEffect(() => {
    const beforePrint = () => {
      beforePrintSection.current = activeSection;
      setActiveSection("all");
    };
    const afterPrint = () => {
      if (beforePrintSection.current) setActiveSection(beforePrintSection.current);
      beforePrintSection.current = null;
    };
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
    };
  }, [activeSection]);

  const selectSection = useCallback((sectionId: ProgressiveSectionId) => {
    setActiveSection(sectionId);
    const url = new URL(window.location.href);
    if (sectionId === "all") {
      url.searchParams.delete("section");
      url.hash = "";
    } else {
      url.searchParams.set("section", sectionId);
      url.hash = sectionId;
    }
    window.history.replaceState(null, "", url);
    // Move the selected panel into view so a selection made at the top of a
    // long report cannot appear to produce an empty page.
    if (sectionId !== "all") scrollSectionIntoView(sectionId);
  }, []);

  const isVisible = useCallback(
    (sectionId: string) => activeSection === "all" || activeSection === sectionId,
    [activeSection],
  );

  return { activeSection, selectSection, isVisible };
}

/** Hide unselected panels at every breakpoint; print restores the full report. */
export function sectionVisibilityClass(visible: boolean): string {
  return visible ? "observe-section" : "progressive-section-hidden";
}

export function ProgressiveSectionNav({
  sections,
  activeSection,
  onSelect,
  summary,
}: {
  sections: ProgressiveSection[];
  activeSection: ProgressiveSectionId;
  onSelect: (sectionId: ProgressiveSectionId) => void;
  summary?: string;
}) {
  const navRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({ left: false, right: false });

  const updateScrollState = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setScrollState({
      left: el.scrollLeft > 1,
      right: Math.ceil(el.scrollLeft + el.clientWidth) < el.scrollWidth - 1,
    });
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      ro.disconnect();
    };
  }, [updateScrollState]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    if (activeSection === "all") {
      scroller.scrollTo({ left: 0, behavior: "auto" });
      return;
    }
    const button = Array.from(scroller.querySelectorAll<HTMLButtonElement>("button[data-section-id]"))
      .find((candidate) => candidate.dataset.sectionId === activeSection);
    if (!button) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    button.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest", inline: "center" });
  }, [activeSection]);

  const selectedIndex = activeSection === "all"
    ? null
    : sections.findIndex((section) => section.id === activeSection);
  const selectedSection = selectedIndex === null || selectedIndex < 0
    ? null
    : sections[selectedIndex];
  const context = activeSection === "all"
    ? "Every section is visible as one continuous report."
    : selectedSection?.description ?? `Showing ${selectedSection?.label ?? "the selected section"}.`;

  return (
    <nav
      ref={navRef}
      aria-label="Page sections"
      data-can-scroll-left={scrollState.left}
      data-can-scroll-right={scrollState.right}
      className="timeline-section-nav relative -mx-4 mb-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-bd-subtle px-4 py-2 md:sticky md:top-0 md:z-30 md:-mx-6 md:mb-5 md:px-6"
      style={{
        background: "color-mix(in srgb, var(--color-bg) 88%, transparent)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      <div ref={scrollerRef} className="timeline-section-nav__scroller flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overscroll-x-contain">
        <span className="sr-only" aria-live="polite">Showing {activeSection === "all" ? "all sections" : sections.find((section) => section.id === activeSection)?.label ?? "selected section"}</span>
        <button
          type="button"
          onClick={() => onSelect("all")}
          data-section-id="all"
          aria-pressed={activeSection === "all"}
          aria-current={activeSection === "all" ? "page" : undefined}
          aria-label="Show all page sections"
          className={clsx(
            "timeline-section-nav__button min-h-10 rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow]",
            activeSection === "all"
              ? "border-accent/50 bg-accent/10 text-accent-soft"
              : "border-transparent text-fg-muted hover:text-fg hover:bg-bg-elev",
          )}
        >
          All
        </button>
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => onSelect(section.id)}
            data-section-id={section.id}
            aria-pressed={activeSection === section.id}
            aria-current={activeSection === section.id ? "page" : undefined}
            title={`Show ${section.label}`}
            className={clsx(
              "timeline-section-nav__button min-h-10 rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow]",
              activeSection === section.id
                ? "border-accent/50 bg-accent/10 text-accent-soft"
                : "border-transparent text-fg-muted hover:text-fg hover:bg-bg-elev",
            )}
          >
            {section.label}
          </button>
        ))}
      </div>
      <div className="timeline-section-nav__context hidden w-full min-w-0 items-center gap-2 px-1 md:flex">
        <span className="shrink-0 text-[9px] font-medium uppercase tracking-[0.12em] text-accent-soft">
          {selectedIndex === null ? "Full report" : `${String(selectedIndex + 1).padStart(2, "0")} / ${String(sections.length).padStart(2, "0")}`}
        </span>
        <span className="min-w-0 truncate text-[11px] text-fg-muted">{context}</span>
        {summary && <span className="ml-auto hidden shrink-0 whitespace-nowrap pl-3 text-[10px] text-fg-dim mono tabular-nums sm:block">{summary}</span>}
      </div>
    </nav>
  );
}
