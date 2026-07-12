"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { MessageSquare, Wrench, AlertTriangle, ListFilter, Search, X } from "lucide-react";
import type { LiveTranscriptTurn } from "@/lib/live";
import { fmtNum } from "@/lib/format";
import { useRedactedShow } from "@/lib/use-redaction";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import ErrorHopper from "./ErrorHopper";
import { RedactToggle } from "./RedactToggle";

/**
 * Interactive transcript viewer: role-styled turns (conversation reads like a
 * conversation, plumbing stays quiet) with filter chips. Turn anchors keep
 * their ORIGINAL indexes so the error hopper works under any filter.
 */

type Filter = "all" | "chat" | "tools" | "errors";

const SEVERITY_TONE: Record<LiveTranscriptTurn["severity"], string> = {
  info: "",
  warning: "border-warn/40 bg-warn/5",
  error: "border-err/40 bg-err/5",
};

function roleTone(t: LiveTranscriptTurn): string {
  if (t.severity !== "info") return "";
  switch (t.role) {
    case "user": return "border-l-2 border-l-accent bg-accent/[0.04]";
    case "assistant": return "border-l-2 border-l-accent/40";
    case "tool": return "border-bd/40";
    default: return "border-bd/30 opacity-70";
  }
}

export default function TranscriptClient({ turns, file }: { turns: LiveTranscriptTurn[]; file?: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, 150).trim().toLowerCase();

  // Harvest from the file path and the transcript itself so bare mentions in
  // prompts/output get scrubbed; secrets on — session logs are exactly where
  // pasted keys and tokens end up.
  const harvestFrom = useMemo(() => [file, ...turns.flatMap((t) => [t.preview, t.label])], [turns, file]);
  const { redact, setRedact, show } = useRedactedShow(harvestFrom, { secrets: true });

  const counts = useMemo(() => ({
    all: turns.length,
    chat: turns.filter((t) => t.role === "user" || t.role === "assistant").length,
    // Must match the filter predicate below — the tools view includes error
    // turns of any role, so its chip count does too.
    tools: turns.filter((t) => t.role === "tool" || t.severity === "error").length,
    errors: turns.filter((t) => t.severity === "error").length,
  }), [turns]);

  const visible = useMemo(() => {
    const pass = (t: LiveTranscriptTurn) => {
      switch (filter) {
        case "chat": return t.role === "user" || t.role === "assistant";
        case "tools": return t.role === "tool" || t.severity === "error";
        case "errors": return t.severity === "error";
        default: return true;
      }
    };
    const matches = (t: LiveTranscriptTurn) =>
      !dq || t.preview.toLowerCase().includes(dq) || t.label.toLowerCase().includes(dq);
    return turns.map((t, i) => ({ t, i })).filter(({ t }) => pass(t) && matches(t));
  }, [turns, filter, dq]);

  const visibleErrorIdx = useMemo(
    () => visible.filter(({ t }) => t.severity === "error").map(({ i }) => i),
    [visible],
  );

  // Redacted text per visible turn, cached — the scrub stack is regex-heavy
  // and must not re-run across thousands of rows on unrelated re-renders.
  const rendered = useMemo(
    () => visible.map(({ t, i }) => ({ t, i, label: show(t.label), preview: t.preview ? show(t.preview) : "" })),
    [visible, show],
  );

  const CHIPS: Array<{ key: Filter; label: string; icon: typeof ListFilter; n: number }> = [
    { key: "all", label: "All", icon: ListFilter, n: counts.all },
    { key: "chat", label: "Conversation", icon: MessageSquare, n: counts.chat },
    { key: "tools", label: "Tools", icon: Wrench, n: counts.tools },
    { key: "errors", label: "Errors", icon: AlertTriangle, n: counts.errors },
  ];

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
      <div className="flex items-center gap-1.5 flex-wrap" role="tablist" aria-label="Turn filter">
        {CHIPS.map(({ key, label, icon: Icon, n }) => (
          <button
            key={key}
            role="tab"
            aria-selected={filter === key}
            onClick={() => setFilter(key)}
            disabled={n === 0 && key !== "all"}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-40",
              filter === key
                ? "border-accent/50 bg-accent/10 text-accent-soft"
                : "border-bd text-fg-muted hover:bg-bg-elev hover:text-fg",
            )}
          >
            <Icon className="size-3" />
            {label}
            <span className={clsx("mono tabular-nums", key === "errors" && n > 0 && "text-err")}>{fmtNum(n)}</span>
          </button>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-fg-dim" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find in transcript…"
            className="w-36 sm:w-44 pl-7 pr-6 py-1 text-[11px] bg-bg border border-bd rounded-full focus:outline-none focus:border-accent placeholder:text-fg-dim transition-[border-color]"
            aria-label="Search transcript text"
          />
          {q && (
            <button onClick={() => setQ("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-fg-dim hover:text-fg" aria-label="Clear search">
              <X className="size-3" />
            </button>
          )}
        </div>
        {dq && (
          <span className="text-[10px] text-fg-dim mono tabular-nums whitespace-nowrap">
            {fmtNum(visible.length)} match{visible.length === 1 ? "" : "es"}
          </span>
        )}
        <RedactToggle compact redact={redact} onToggle={() => setRedact((v) => !v)} />
      </div>
      </div>

      {/* Hops over the errors VISIBLE under the current filter/search — ids keep
          original indexes, so anchors always exist. Key resets its cursor when
          the visible set changes shape. */}
      {visibleErrorIdx.length > 0 && <ErrorHopper key={`${filter}:${dq}`} errorTurnIndexes={visibleErrorIdx} />}

      <div className="space-y-1">
        {rendered.length === 0 && (
          <div className="card p-6 text-center text-sm text-fg-dim">{dq ? "No turns match your search." : "Nothing matches this filter."}</div>
        )}
        {rendered.map(({ t, i, label, preview }) => {
          const meta = t.role === "meta" && t.severity === "info";
          return (
            <div key={i} id={`turn-${i}`} className={clsx(meta ? "cv-auto" : "cv-auto-lg", "card border rounded-md", SEVERITY_TONE[t.severity], roleTone(t), meta ? "px-3 py-1" : "px-3 py-2")}>
              <div className="flex items-center justify-between gap-3">
                <span
                  className={clsx(
                    "text-[11px] font-medium",
                    t.severity === "error" ? "text-err"
                      : t.severity === "warning" ? "text-warn"
                      : t.role === "user" ? "text-accent-soft"
                      : t.role === "assistant" ? "text-fg"
                      : t.role === "tool" ? "text-fg-muted mono"
                      : "text-fg-dim",
                  )}
                >
                  {label}
                </span>
                <span className="text-[10px] text-fg-dim mono shrink-0 tabular-nums">{t.at ? new Date(t.at).toLocaleTimeString() : ""}</span>
              </div>
              {preview && (meta ? (
                <div className="text-[11px] mono text-fg-dim truncate">{preview}</div>
              ) : (
                <pre className={clsx(
                  "mt-1 text-[12px] whitespace-pre-wrap break-words max-h-48 overflow-y-auto",
                  t.role === "user" || t.role === "assistant" ? "font-sans text-fg/90 leading-relaxed" : "mono text-fg-muted",
                )}>{preview}</pre>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
