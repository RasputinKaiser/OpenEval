"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useFocusTrap } from "@/lib/use-focus-trap";

const SHORTCUTS = [
  { keys: ["⌘", "K"], label: "Open command palette (Ctrl+K on Windows/Linux)", group: "Global" },
  { keys: ["/"], label: "Focus search on current page", group: "Global" },
  { keys: ["?"], label: "Toggle this shortcuts help", group: "Global" },
  { keys: ["Esc"], label: "Close drawer / modal / overlay", group: "Global" },
  { keys: ["↑", "↓"], label: "Navigate command palette results", group: "Command Palette" },
  { keys: ["Enter"], label: "Open selected command", group: "Command Palette" },
  { keys: ["g", "d"], label: "Go to Dashboard", group: "Navigation" },
  { keys: ["g", "r"], label: "Go to Runs", group: "Navigation" },
  { keys: ["g", "l"], label: "Go to Live", group: "Navigation" },
  { keys: ["g", "c"], label: "Go to Cases", group: "Navigation" },
  { keys: ["g", "n"], label: "Go to New Run", group: "Navigation" },
  { keys: ["g", "h"], label: "Go to Leaderboard", group: "Navigation" },
  { keys: ["g", "o"], label: "Go to Compare", group: "Navigation" },
  { keys: ["g", "a"], label: "Go to Accuracy", group: "Navigation" },
  { keys: ["g", "p"], label: "Go to Harnesses", group: "Navigation" },
];

const GROUPS = ["Global", "Command Palette", "Navigation"] as const;

export default function ShortcutsOverlay() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        const active = document.activeElement;
        const tag = active?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select" || (active as HTMLElement)?.isContentEditable) return;
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape" && open) {
        // Claim the Escape so overlays underneath (e.g. MobileNav) stay open.
        e.preventDefault();
        e.stopImmediatePropagation();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div aria-hidden="true" className="absolute inset-0 bg-black/50 transition-opacity duration-150" onClick={() => setOpen(false)} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-overlay-title"
        tabIndex={-1}
        className="relative w-full max-w-md mx-4 rounded-lg border border-bd bg-bg-subtle shadow-2xl overflow-hidden anim-menu-enter"
      >
        <div className="border-b border-bd-subtle px-4 py-3">
          <h2 id="shortcuts-overlay-title" className="text-sm font-semibold">Keyboard Shortcuts</h2>
        </div>
        {/* Focusable so keyboard users can scroll the list. */}
        <div tabIndex={0} data-autofocus aria-label="Shortcut list" className="max-h-[60vh] overflow-y-auto py-3">
          {GROUPS.map((group) => (
            <div key={group} className="mb-3">
              <div className="px-4 pb-1 text-[9px] uppercase tracking-wider text-fg-dim">{group}</div>
              {SHORTCUTS.filter((s) => s.group === group).map((s, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-1.5 text-sm">
                  <span className="text-fg-muted">{s.label}</span>
                  <div className="flex items-center gap-1">
                    {s.keys.map((key, j) => (
                      <kbd key={j} className={clsx("rounded bg-bg-elev px-1.5 py-0.5 text-[10px] mono text-fg-muted", key.length > 1 && "min-w-6 text-center")}>{key}</kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="border-t border-bd-subtle px-4 py-2 text-[10px] text-fg-dim text-center">
          Press <kbd className="rounded bg-bg-elev px-1 py-0.5">Esc</kbd> to close
        </div>
      </div>
    </div>
  );
}
