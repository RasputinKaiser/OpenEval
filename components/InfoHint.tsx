"use client";

import { Info } from "lucide-react";
import clsx from "clsx";

/**
 * Unobtrusive jargon hint: a small info glyph with a native-title tooltip that is
 * ALSO keyboard-reachable (focus shows the same text via aria-label). Native title
 * means zero portal/positioning machinery and it never blocks clicks. Use for terms
 * whose definition fits in one sentence; anything longer deserves visible copy.
 */
export function InfoHint({ term, explanation, className }: { term: string; explanation: string; className?: string }) {
  return (
    <span
      tabIndex={0}
      role="note"
      aria-label={`${term}: ${explanation}`}
      title={`${term}: ${explanation}`}
      className={clsx(
        "inline-grid place-items-center size-3.5 rounded-full text-fg-dim hover:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-help",
        className,
      )}
    >
      <Info aria-hidden="true" className="size-3" />
    </span>
  );
}
