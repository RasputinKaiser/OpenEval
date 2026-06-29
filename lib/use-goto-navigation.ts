"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const GOTO: Record<string, string> = {
  r: "/runs",
  l: "/live",
  c: "/cases",
  d: "/",
  n: "/runs/new",
  h: "/runs/leaderboard",
  o: "/runs/compare",
  a: "/accuracy",
  p: "/harnesses",
};

export function useGotoNavigation() {
  const router = useRouter();
  useEffect(() => {
    let pressingG = false;
    let gTimeout: ReturnType<typeof setTimeout> | null = null;

    function handler(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const active = document.activeElement;
      const tag = active?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || (active as HTMLElement)?.isContentEditable) return;

      if (e.key === "g" && !pressingG) {
        pressingG = true;
        if (gTimeout) clearTimeout(gTimeout);
        gTimeout = setTimeout(() => { pressingG = false; }, 800);
        return;
      }
      if (pressingG) {
        const target = GOTO[e.key.toLowerCase()];
        if (target) {
          e.preventDefault();
          router.push(target);
        }
        pressingG = false;
        if (gTimeout) clearTimeout(gTimeout);
      }
    }
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      if (gTimeout) clearTimeout(gTimeout);
    };
  }, [router]);
}