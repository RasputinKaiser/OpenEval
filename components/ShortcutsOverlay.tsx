"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";

const SHORTCUTS = [
  { keys: ["", "K"], label: "Open command palette", group: "Global" },
  { keys: ["/"], label: "Focus search on current page", group: "Global" },
  { keys: ["?"], label: "Toggle this shortcuts help", group: "Global" },
  { keys: ["Esc"], label: "Close drawer / modal / overlay", group: "Global" },
  { keys: ["↑", "↓"], label: "Navigate command palette results", group: "Command Palette" },
  { keys: ["Enter"], label: "Open selected command", group: "Command Palette" },
  { keys: ["g", "r"], label: "Go to Runs", group: "Navigation" },
  { keys: ["g", "l"], label: "Go to Live", group: "Navigation" },
  { keys: ["g", "c"], label: "Go to Cases", group: "Navigation" },
  { keys: ["g", "d"], label: "Go to Dashboard", group: "Navigation" },
  { keys: ["g", "n"], label: "Go to New Run", group: "Navigation" },
];

const GROUPS = ["Global", "Command Palette", "Navigation"] as const;

export default function ShortcutsOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        const active = document.activeElement;
        const tag = active?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea") return;
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape" && open) setOpen(false);
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 transition-opacity duration-150" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-md mx-4 rounded-lg border border-bd bg-bg-subtle shadow-2xl overflow-hidden" style={{ animation: "menu-enter 120ms cubic-bezier(0.2, 0, 0, 1)" }}>
        <div className="border-b border-bd-subtle px-4 py-3">
          <h2 className="text-sm font-semibold">Keyboard Shortcuts</h2>
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-3">
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