"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import clsx from "clsx";

export default function ThemeToggle({ collapsed }: { collapsed?: boolean }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    try {
      const stored = localStorage.getItem("openeval-theme");
      if (stored === "light") {
        document.documentElement.classList.add("light");
        setTheme("light");
      } else if (!stored) {
        const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
        if (prefersLight) {
          document.documentElement.classList.add("light");
          setTheme("light");
        }
      }
    } catch {}
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem("openeval-theme", next); } catch {}
    if (next === "light") document.documentElement.classList.add("light");
    else document.documentElement.classList.remove("light");
  }

  return (
    <button
      onClick={toggle}
      className={clsx("min-h-8 min-w-8 flex items-center justify-center rounded text-fg-dim hover:text-fg hover:bg-bg-elev transition-colors")}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={collapsed ? (theme === "dark" ? "Light mode" : "Dark mode") : undefined}
    >
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}