import { useEffect } from "react";

/**
 * Focuses the referenced element when the user presses `/` outside of an input.
 * Standard dashboard pattern (GitHub, Linear, Notion).
 */
export function useFocusOnSlash(ref: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key !== "/") return;
      const active = document.activeElement;
    const tag = active?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || (active as HTMLElement)?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      ref.current?.focus();
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [ref]);
}