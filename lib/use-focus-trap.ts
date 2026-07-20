"use client";

import { useEffect } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps Tab focus inside `ref` while `active`, moves focus in on mount
 * (preferring an element marked `data-autofocus`), and restores focus to the
 * previously focused element when the trap deactivates. Shared by the modal
 * primitives (CommandPalette, ShortcutsOverlay, MobileNav).
 */
export function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;
    const previous = document.activeElement as HTMLElement | null;

    const initial =
      container.querySelector<HTMLElement>("[data-autofocus]") ??
      container.querySelector<HTMLElement>(FOCUSABLE) ??
      container;
    // Synchronous: the effect runs after the open render is committed, and
    // rAF-deferred focus never fires in throttled/occluded renderers.
    initial.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !container) return;
      const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.getClientRects().length > 0 || el === document.activeElement
      );
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const current = document.activeElement;
      if (e.shiftKey && (current === first || current === container || !container.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !container.contains(current))) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previous?.focus?.();
    };
  }, [ref, active]);
}
