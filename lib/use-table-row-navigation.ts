"use client";

import { useEffect, useRef, useState } from "react";

export function useTableRowNavigation(rowCount: number, onSelect: (index: number) => void) {
  const [focusedRow, setFocusedRow] = useState(-1);
  const lastInteract = useRef(0);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const active = document.activeElement;
      const tag = active?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || (active as HTMLElement)?.isContentEditable) return;

      const now = Date.now();
      if (now - lastInteract.current > 2000) {
        setFocusedRow(-1);
      }

      if (e.key === "j" || e.key === "ArrowDown") {
        if (focusedRow === -1 && rowCount > 0) {
          e.preventDefault();
          setFocusedRow(0);
          onSelect(0);
        } else if (focusedRow < rowCount - 1) {
          e.preventDefault();
          setFocusedRow(focusedRow + 1);
          onSelect(focusedRow + 1);
        }
        lastInteract.current = now;
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        if (focusedRow > 0) {
          e.preventDefault();
          setFocusedRow(focusedRow - 1);
          onSelect(focusedRow - 1);
        }
        lastInteract.current = now;
      }
      if (e.key === "Enter" && focusedRow >= 0) {
        lastInteract.current = now;
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [focusedRow, rowCount, onSelect]);

  return { focusedRow, setFocusedRow };
}