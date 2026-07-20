"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Menu, X } from "lucide-react";
import { SECTIONS } from "./Sidebar";
import { useFocusTrap } from "@/lib/use-focus-trap";

export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
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

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    if (href === "/runs") return pathname === "/runs" || /^\/runs\/(?!new(?:\/|$)|compare(?:\/|$)|leaderboard(?:\/|$))[^/]+/.test(pathname);
    if (href === "/collection") return pathname === "/collection";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 md:hidden size-12 rounded-full bg-accent text-white shadow-lg flex items-center justify-center active:scale-95 transition-transform"
        aria-label="Open navigation menu"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Menu aria-hidden="true" className="size-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-[90] md:hidden">
          <div aria-hidden="true" className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Mobile navigation"
            className="absolute right-0 top-0 h-full w-72 bg-bg-subtle border-l border-bd p-4 overflow-y-auto anim-menu-enter"
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-semibold">Navigation</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-10 min-w-10 flex items-center justify-center rounded hover:bg-bg-elev"
                aria-label="Close navigation menu"
              >
                <X className="size-5 text-fg-muted" aria-hidden="true" />
              </button>
            </div>
            <nav aria-label="Primary" className="space-y-1">
              {SECTIONS.map((section, si) => (
                <div key={section.label ?? si}>
                  {section.label && (
                    <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest text-fg-dim select-none">{section.label}</div>
                  )}
                  {section.items.map((item) => {
                    const active = isActive(item.href);
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={clsx(
                          "flex items-center gap-2 rounded-md px-3 py-3 text-sm transition-colors",
                          active ? "bg-accent/15 text-accent-soft" : "text-fg-muted hover:bg-bg-elev hover:text-fg"
                        )}
                      >
                        <Icon aria-hidden="true" className="size-4" />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
