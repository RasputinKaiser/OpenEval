"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Shared pointer-following tooltip for charts. Fixed-positioned so it works
 * inside scroll containers, clamped to the viewport, and pointer-transparent
 * so it never steals the hover that opened it. Content is React nodes (text
 * interpolation — never raw HTML), so untrusted names render inert.
 *
 * Marks can also PIN the tooltip (tap on touch, Enter/Space or click from the
 * keyboard): a pinned tip ignores hover updates and stays until Escape, a tap
 * elsewhere, or toggling the same mark again — hover is never required.
 */

export interface TipState {
  x: number; // viewport coords (clientX/Y)
  y: number;
  content: ReactNode;
  /** Identity of the mark that pinned this tip — toggling the same key unpins. */
  pinKey?: string;
}

/** Minimal event shape shared by mouse/pointer events on marks. */
interface MarkEvent {
  clientX: number;
  clientY: number;
  currentTarget: EventTarget | null;
}

function anchorOf(e: MarkEvent): { x: number; y: number } {
  // Keyboard-triggered clicks carry (0,0) coords — anchor to the mark instead.
  if ((e.clientX !== 0 || e.clientY !== 0) || !(e.currentTarget instanceof Element)) {
    return { x: e.clientX, y: e.clientY };
  }
  const r = e.currentTarget.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top };
}

/** Cross-instance coordination: pinning in one chart unpins every other chart. */
const PIN_EVENT = "oe-charttip-pin";

export function useChartTooltip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const instanceId = useRef<object | null>(null);
  if (instanceId.current === null) instanceId.current = {};
  const pinned = tip?.pinKey != null;
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;

  const show = (e: { clientX: number; clientY: number }, content: ReactNode) => {
    if (pinnedRef.current) return;
    setTip({ x: e.clientX, y: e.clientY, content });
  };
  /** Focus events carry no pointer coords — anchor to the focused element instead. */
  const showAt = (el: Element, content: ReactNode) => {
    if (pinnedRef.current) return;
    const r = el.getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, y: r.top, content });
  };
  const hide = () => {
    if (pinnedRef.current) return;
    setTip(null);
  };
  const unpin = () => setTip(null);
  /**
   * Tap/click/Enter on a mark: pin the tip there; the same mark toggles off.
   * Callers must stopPropagation so the document-level dismiss doesn't fire;
   * a broadcast event still unpins every OTHER chart's tooltip instance.
   */
  const togglePin = (e: MarkEvent, content: ReactNode, pinKey: string) => {
    // Resolve the anchor before the updater runs — React nulls a synthetic
    // event's currentTarget as soon as the handler returns.
    const { x, y } = anchorOf(e);
    document.dispatchEvent(new CustomEvent(PIN_EVENT, { detail: instanceId.current }));
    setTip((cur) => (cur?.pinKey === pinKey ? null : { x, y, content, pinKey }));
  };

  // A pinned tip dismisses on Escape, any tap/click outside a pinning mark,
  // any scroll (fixed positioning would leave it floating over moved content),
  // or another chart instance pinning its own tip.
  useEffect(() => {
    if (!pinned) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setTip(null); };
    const onClick = () => setTip(null);
    const onScroll = () => setTip(null);
    const onPinElsewhere = (e: Event) => {
      if ((e as CustomEvent).detail !== instanceId.current) setTip(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    document.addEventListener(PIN_EVENT, onPinElsewhere);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
      document.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener(PIN_EVENT, onPinElsewhere);
    };
  }, [pinned]);

  return { tip, pinned, show, showAt, hide, togglePin, unpin };
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
  const pinned = tip.pinKey != null;
  return (
    <div
      ref={ref}
      role="status"
      className={
        "fixed z-50 pointer-events-none rounded-md border bg-bg-elev px-2.5 py-1.5 text-[11px] shadow-lg max-w-[300px] " +
        (pinned ? "border-accent/60" : "border-bd")
      }
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      {tip.content}
      {pinned && <div className="mt-1 text-[9px] text-fg-dim">pinned — esc or tap away to close</div>}
    </div>
  );
}
