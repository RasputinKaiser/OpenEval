"use client";

import { memo, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ChevronRight, Loader2, Wrench } from "lucide-react";
import type { TranscriptEntry } from "@/lib/types";

const MAX_ENTRY_LEN = 8000;
const TRANSCRIPT_INITIAL = 60;
const TRANSCRIPT_PAGE = 60;

const ROLE_TINT: Record<string, string> = {
  assistant: "bg-accent/5",
  user: "bg-bg-subtle/40",
  system: "bg-warn/5",
};

const ROLE_LABEL: Record<string, string> = {
  assistant: "text-accent-soft",
  user: "text-fg-dim",
  system: "text-warn",
};

/** Incrementally paginated transcript viewer (IntersectionObserver-driven). */
export default function Transcript({ transcript }: { transcript: TranscriptEntry[] }) {
  const [visible, setVisible] = useState(TRANSCRIPT_INITIAL);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const total = transcript.length;

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || visible >= total) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible((v) => Math.min(v + TRANSCRIPT_PAGE, total));
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [visible, total]);

  // Reset pagination when transcript identity changes (new case selected)
  useEffect(() => { setVisible(TRANSCRIPT_INITIAL); }, [transcript]);

  const shown = transcript.slice(0, visible);
  const remaining = total - visible;

  return (
    <div className="font-mono text-[12px]">
      {shown.map((entry, i) => (
        <TranscriptEntryRow key={entry.uuid || i} entry={entry} />
      ))}
      {remaining > 0 && (
        <div ref={sentinelRef} className="py-3 text-center text-[11px] text-fg-dim">
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="size-3 animate-spin" />
            {remaining} more entr{remaining === 1 ? "y" : "ies"}
          </span>
        </div>
      )}
    </div>
  );
}

const TranscriptEntryRow = memo(function TranscriptEntryRow({ entry }: { entry: TranscriptEntry }) {
  const [showMore, setShowMore] = useState(false);
  let budget = showMore ? Infinity : MAX_ENTRY_LEN;
  let cut = false;

  const blocks = entry.content.map((block, j) => {
    if (cut) return null;
    if (block.type === "text") {
      const text = budget === Infinity ? block.text : block.text.slice(0, Math.max(0, budget));
      if (budget !== Infinity) budget = Math.max(0, budget - text.length);
      cut = budget === 0 && block.text.length > text.length;
      return <pre key={j} className="px-4 py-2 text-fg whitespace-pre-wrap break-words">{text}</pre>;
    }
    if (block.type === "tool_use") {
      const input = typeof block.input === "string" ? block.input : JSON.stringify(block.input);
      if (budget !== Infinity) budget = Math.max(0, budget - input.length);
      return (
        <div key={j} className="px-4 py-2 flex items-start gap-2">
          <Wrench className="size-3 text-accent-soft mt-0.5 shrink-0" />
          <span className="text-accent-soft shrink-0">{block.name}</span>
          <span className="text-fg-dim whitespace-pre-wrap break-words">{input}</span>
        </div>
      );
    }
    if (block.type === "tool_result") {
      const max = budget === Infinity ? block.content.length : Math.max(0, budget);
      const text = block.content.slice(0, max);
      if (budget !== Infinity) budget = Math.max(0, budget - text.length);
      cut = budget === 0 && block.content.length > text.length;
      return (
        <details key={j} className="group px-4 py-2">
          <summary className="cursor-pointer text-[10px] uppercase text-fg-dim flex items-center gap-1 select-none">
            <ChevronRight className="size-3 group-open:rotate-90 transition-transform" /> Tool result
            {block.is_error && <span className="ml-1 text-err">(error)</span>}
          </summary>
          <pre className={clsx("mt-1 pl-5 text-[11px] mono whitespace-pre-wrap border-l-2 break-words max-h-96 overflow-auto", block.is_error ? "border-err/50 text-err/80" : "border-bd-subtle text-fg-muted")}>{text}</pre>
        </details>
      );
    }
    return null;
  });

  return (
    <div className="border-b border-bd-subtle last:border-0">
      <div className={clsx("px-4 py-1.5 flex items-center gap-2", ROLE_TINT[entry.role] ?? "bg-bg-subtle/40")}>
        <span className={clsx("text-[10px] uppercase tracking-wider", ROLE_LABEL[entry.role] ?? "text-fg-dim")}>{entry.role}</span>
        {entry.atMs !== undefined && <span className="text-[10px] text-fg-dim mono tabular-nums">@ {entry.atMs}ms</span>}
      </div>
      {blocks}
      {(cut || showMore) && (
        <button
          onClick={() => setShowMore(!showMore)}
          className="px-4 py-1.5 text-[10px] text-accent-soft hover:underline"
        >
          {showMore ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
});
