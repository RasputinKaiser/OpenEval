"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Activity, LayoutDashboard, MoreHorizontal, Radio, X } from "lucide-react";
import { SECTIONS } from "./Sidebar";
import SupportLinks from "./SupportLinks";
import { useFocusTrap } from "@/lib/use-focus-trap";

const PRIMARY_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/live", label: "Live", icon: Radio },
  { href: "/runs", label: "Runs", icon: Activity },
] as const;

const MORE_ITEMS = SECTIONS.flatMap((section) => section.items).filter(
  (item) => !PRIMARY_ITEMS.some((primary) => primary.href === item.href),
);

export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const openedRef = useRef(false);
  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      // defaultPrevented = a stacked overlay (palette/shortcuts) claimed it.
      if (e.key === "Escape" && !e.defaultPrevented) setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // useFocusTrap restores the previously focused element. Keep the explicit
  // trigger restore here too, so a pointer-opened More sheet has a deterministic
  // target even when another overlay claimed focus before it closed.
  useEffect(() => {
    if (open) {
      openedRef.current = true;
      return;
    }
    if (openedRef.current) {
      moreButtonRef.current?.focus();
      openedRef.current = false;
    }
  }, [open]);

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    if (href === "/runs") return pathname === "/runs" || /^\/runs\/(?!new(?:\/|$)|compare(?:\/|$)|leaderboard(?:\/|$))[^/]+/.test(pathname);
    if (href === "/collection") return pathname === "/collection";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const moreActive = MORE_ITEMS.some((item) => isActive(item.href));

  function closeMore() {
    setOpen(false);
  }

  return (
    <>
      <nav
        aria-label="Mobile navigation"
        className="mobile-nav-shell fixed inset-x-0 bottom-0 z-50 border-t backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mobile-nav__grid grid h-16 grid-cols-4">
          {PRIMARY_ITEMS.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "mobile-nav__item flex min-w-0 flex-col items-center justify-center gap-1 text-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                  active && "mobile-nav__item--active",
                )}
              >
                <Icon aria-hidden="true" className="size-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
          <button
            ref={moreButtonRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-label="More navigation"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls="mobile-more-panel"
            className={clsx(
              "mobile-nav__item flex min-w-0 flex-col items-center justify-center gap-1 text-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
              (moreActive || open) && "mobile-nav__item--active",
            )}
          >
            <MoreHorizontal aria-hidden="true" className="size-5" />
            <span>More</span>
          </button>
        </div>
      </nav>
      {/* Reserve the fixed bar's height so the final page content is not covered. */}
      <div aria-hidden="true" className="mobile-nav-spacer h-16 md:hidden" style={{ height: "calc(4rem + env(safe-area-inset-bottom))" }} />

      {open && (
        <div className="fixed inset-0 z-[90] md:hidden">
          <div aria-hidden="true" className="mobile-more-backdrop absolute inset-0" onClick={closeMore} />
          <div
            ref={panelRef}
            id="mobile-more-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-more-title"
            className="mobile-more-sheet absolute inset-x-0 bottom-0 max-h-[min(78vh,36rem)] overflow-y-auto rounded-t-xl border p-4 shadow-2xl anim-menu-enter"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 id="mobile-more-title" className="text-sm font-semibold">More</h2>
              <button
                type="button"
                onClick={closeMore}
                data-autofocus
                className="mobile-more-close flex items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label="Close More navigation"
              >
                <X className="size-5 text-fg-muted" aria-hidden="true" />
              </button>
            </div>
            <nav aria-label="More destinations" className="mobile-more__nav space-y-1">
              {SECTIONS.map((section, si) => {
                const items = section.items.filter((item) => MORE_ITEMS.includes(item));
                if (items.length === 0) return null;
                return (
                  <div key={section.label ?? si}>
                    {section.label && <div className="mobile-more__section-title px-3 pb-1 pt-3 text-[10px] uppercase tracking-widest select-none">{section.label}</div>}
                    {items.map((item) => {
                      const active = isActive(item.href);
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={closeMore}
                          aria-current={active ? "page" : undefined}
                          className={clsx(
                            "mobile-more__item flex items-center gap-2 rounded-md px-3 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                            active && "mobile-more__item--active",
                          )}
                        >
                          <Icon aria-hidden="true" className="size-4" />
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                );
              })}
            </nav>
            <div className="mt-4 border-t border-bd pt-2">
              <SupportLinks headingId="mobile-support-links-title" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
