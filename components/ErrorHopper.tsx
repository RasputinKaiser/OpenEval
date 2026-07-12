"use client";

import { useState } from "react";
import { ChevronUp, ChevronDown, AlertTriangle } from "lucide-react";

/**
 * Floating prev/next navigation between erroring turns in the transcript
 * viewer. Anchors are `#turn-<index>` rendered by the server component.
 */
export default function ErrorHopper({ errorTurnIndexes }: { errorTurnIndexes: number[] }) {
  const [pos, setPos] = useState(-1);
  if (errorTurnIndexes.length === 0) return null;

  const jump = (dir: 1 | -1) => {
    const next = Math.min(Math.max(pos + dir, 0), errorTurnIndexes.length - 1);
    setPos(next);
    document.getElementById(`turn-${errorTurnIndexes[next]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 card px-2 py-1.5 flex items-center gap-2 shadow-lg">
      <AlertTriangle className="size-3.5 text-err shrink-0" />
      <span className="text-[11px] text-fg-muted mono tabular-nums">
        {pos >= 0 ? pos + 1 : "–"}/{errorTurnIndexes.length} errors
      </span>
      <button
        onClick={() => jump(-1)}
        disabled={pos <= 0}
        aria-label="Previous error"
        className="min-h-10 min-w-10 grid place-items-center rounded-md hover:bg-bg-elev text-fg-muted disabled:opacity-40"
      >
        <ChevronUp className="size-4" />
      </button>
      <button
        onClick={() => jump(1)}
        disabled={pos >= errorTurnIndexes.length - 1}
        aria-label="Next error"
        className="min-h-10 min-w-10 grid place-items-center rounded-md hover:bg-bg-elev text-fg-muted disabled:opacity-40"
      >
        <ChevronDown className="size-4" />
      </button>
    </div>
  );
}
