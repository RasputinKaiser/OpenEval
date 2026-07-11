"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Shared pointer-following tooltip for charts. Fixed-positioned so it works
 * inside scroll containers, clamped to the viewport, and pointer-transparent
 * so it never steals the hover that opened it. Content is React nodes (text
 * interpolation — never raw HTML), so untrusted names render inert.
 */

export interface TipState {
  x: number; // viewport coords (clientX/Y)
  y: number;
  content: ReactNode;
}

export function useChartTooltip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const show = (e: { clientX: number; clientY: number }, content: ReactNode) =>
    setTip({ x: e.clientX, y: e.clientY, content });
  /** Focus events carry no pointer coords — anchor to the focused element instead. */
  const showAt = (el: Element, content: ReactNode) => {
    const r = el.getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, y: r.top, content });
  };
  const hide = () => setTip(null);
  return { tip, show, showAt, hide };
}

export function ChartTooltip({ tip }: { tip: TipState | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!tip || !ref.current) { setPos(null); return; }
    const { width, height } = ref.current.getBoundingClientRect();
    const left = Math.min(Math.max(tip.x - width / 2, 8), window.innerWidth - width - 8);
    let top = tip.y - height - 10;
    if (top < 8) top = tip.y + 14; // flip below the pointer near the viewport top
    setPos({ left, top });
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={ref}
      role="status"
      className="fixed z-50 pointer-events-none rounded-md border border-bd bg-bg-elev px-2.5 py-1.5 text-[11px] shadow-lg max-w-[300px]"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      {tip.content}
    </div>
  );
}
