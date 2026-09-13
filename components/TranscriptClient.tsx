"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Loader2, MessageSquare, Wrench, AlertTriangle, ListFilter, Search, X, ScanLine, ImageIcon, FileIcon, ChevronUp, ChevronDown } from "lucide-react";
import type { LiveTranscriptTurn, TranscriptNormalization } from "@/lib/live";
import { fmtDateTime, fmtNum, fmtStableDateTime, fmtTime } from "@/lib/format";
import { useRedactedShow } from "@/lib/use-redaction";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { TranscriptContent } from "./TranscriptContent";
import { TranscriptSearch } from "./TranscriptSearch";
import ErrorHopper from "./ErrorHopper";
import { RedactToggle } from "./RedactToggle";
import { AgentReasoningBlock, isAgentReasoningTurn } from "./live/AgentReasoningBlock";

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

type TurnCounts = Record<Filter, number>;

const PAGE_SIZE = 240;

function countTurns(turns: LiveTranscriptTurn[]): TurnCounts {
  return {
    all: turns.length,
    chat: turns.filter((t) => t.role === "user" || t.role === "assistant").length,
    tools: turns.filter((t) => t.role === "tool" || t.severity === "error").length,
    errors: turns.filter((t) => t.severity === "error").length,
  };
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function initialCounts(turns: LiveTranscriptTurn[], total: number, supplied?: Partial<TurnCounts>): TurnCounts {
  const loaded = countTurns(turns);
  return {
    all: isCount(supplied?.all) ? Math.max(supplied.all, turns.length) : Math.max(total, turns.length),
    chat: isCount(supplied?.chat) ? supplied.chat : loaded.chat,
    tools: isCount(supplied?.tools) ? supplied.tools : loaded.tools,
    errors: isCount(supplied?.errors) ? supplied.errors : loaded.errors,
  };
}

type TranscriptPage = {
  turns?: LiveTranscriptTurn[];
  windowCursor?: string;
  error?: string;
  offset?: number;
  total?: number;
  counts?: Partial<TurnCounts>;
  normalization?: TranscriptNormalization;
  revision?: string | { size: number; mtimeMs: number; fingerprint: string };
  nextCursor?: string | null;
  hasMore?: boolean;
};

export default function TranscriptClient({
  turns,
  initialOffset = 0,
  initialTargetIndex,
  initialWindowCursor,
  sourceId,
  sessionId,
  initialCursor,
  hasMore: initialHasMore = false,
  totalTurns = turns.length,
  totalCounts,
  normalization,
}: {
  turns: LiveTranscriptTurn[];
  initialOffset?: number;
  initialTargetIndex?: number;
  initialWindowCursor?: string;
  sourceId: string;
  sessionId: string;
  initialCursor?: string | null;
  hasMore?: boolean;
  totalTurns?: number;
  totalCounts?: Partial<TurnCounts>;
  normalization?: TranscriptNormalization;
}) {
  const [loadedTurns, setLoadedTurns] = useState(turns);
  const [checkpoints, setCheckpoints] = useState([{ offset: initialOffset, cursor: initialWindowCursor }]);
  const [knownTotal, setKnownTotal] = useState(() => Math.max(totalTurns, turns.length));
  const [nextCursor, setNextCursor] = useState<string | null>(initialCursor ?? null);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [knownCounts, setKnownCounts] = useState<TurnCounts>(() => initialCounts(turns, totalTurns, totalCounts));
  const defaultFilter: Filter = (totalCounts?.chat ?? countTurns(turns).chat) > 0 ? "chat" : "all";
  const [filter, setFilter] = useState<Filter>(defaultFilter);
  const [q, setQ] = useState("");
  const [mounted, setMounted] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sourceNotice, setSourceNotice] = useState<string | null>(null);
  const [knownNormalization, setKnownNormalization] = useState(normalization);
  const requestGeneration = useRef(0);
  const requestInFlight = useRef(false);
  const loadedTurnsRef = useRef(turns);
  const knownTotalRef = useRef(Math.max(totalTurns, turns.length));
  const dq = useDebouncedValue(q, 150).trim().toLowerCase();

  useEffect(() => {
    setMounted(true);
    if (window.location.hash.startsWith("#turn-")) setFilter("all");
  }, []);

  useEffect(() => {
    requestGeneration.current += 1;
    requestInFlight.current = false;
    loadedTurnsRef.current = turns;
    knownTotalRef.current = Math.max(totalTurns, turns.length);
    setLoadedTurns(turns);
    setCheckpoints([{ offset: initialOffset, cursor: initialWindowCursor }]);
    setKnownTotal(Math.max(totalTurns, turns.length));
    setKnownCounts(initialCounts(turns, totalTurns, totalCounts));
    setFilter(window.location.hash.startsWith("#turn-") ? "all" : defaultFilter);
    setQ("");
    setLoadError(null);
    setSourceNotice(null);
    setKnownNormalization(normalization);
    setNextCursor(initialCursor ?? null);
    setHasMore(initialHasMore);
  }, [defaultFilter, sourceId, sessionId, turns, totalTurns, totalCounts, normalization, initialCursor, initialHasMore, initialOffset, initialWindowCursor]);

  // Harvest from the file path and the transcript itself so bare mentions in
  // prompts/output get scrubbed; secrets on — session logs are exactly where
  // pasted keys and tokens end up.
  const harvestFrom = useMemo(() => [sourceId, sessionId, ...loadedTurns.flatMap((t) => [t.preview, t.label])], [loadedTurns, sourceId, sessionId]);
  const { redact, setRedact, show } = useRedactedShow(harvestFrom, { secrets: true });

  useEffect(() => {
    let first = 0, second = 0;
    const locate = () => {
      cancelAnimationFrame(first); cancelAnimationFrame(second);
      first = requestAnimationFrame(() => { second = requestAnimationFrame(() => {
        const id = window.location.hash.slice(1);
        if (!/^turn-\d+$/.test(id)) return;
        const element = document.getElementById(id);
        if (!element) return;
        document.querySelectorAll("[data-transcript-inspected]").forEach(node => node.removeAttribute("data-transcript-inspected"));
        element.setAttribute("data-transcript-inspected", "true");
        element.tabIndex = -1;
        element.scrollIntoView({ block: "center", behavior: "auto" });
        element.focus({ preventScroll: true });
      }); });
    };
    locate(); window.addEventListener("hashchange", locate);
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); window.removeEventListener("hashchange", locate); };
  }, [turns, initialOffset, initialWindowCursor]);

  const counts = knownCounts;

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
      !dq
      || t.preview.toLowerCase().includes(dq)
      || t.label.toLowerCase().includes(dq)
      || t.tool?.name.toLowerCase().includes(dq)
      || t.tool?.callId?.toLowerCase().includes(dq);
    return loadedTurns.map((t, i) => ({ t, i: i + initialOffset })).filter(({ t }) => pass(t) && matches(t));
  }, [loadedTurns, filter, dq, initialOffset]);

  const visibleErrorIdx = useMemo(
    () => visible.filter(({ t }) => t.severity === "error").map(({ i }) => i),
    [visible],
  );
  const matchIndexes = useMemo(() => (dq ? visible.map(({ i }) => i) : []), [dq, visible]);
  const [matchPos, setMatchPos] = useState(-1);

  useEffect(() => {
    setMatchPos(-1);
  }, [filter, dq, loadedTurns.length]);

  function jumpToMatch(direction: 1 | -1) {
    if (matchIndexes.length === 0) return;
    const next = matchPos < 0
      ? direction === 1 ? 0 : matchIndexes.length - 1
      : Math.min(Math.max(matchPos + direction, 0), matchIndexes.length - 1);
    setMatchPos(next);
    document.getElementById(`turn-${matchIndexes[next]}`)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  }

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

  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  const loadMoreStable = useCallback(() => loadMoreRef.current(), []);
  async function loadMore() {
    const currentTurns = loadedTurnsRef.current;
    if (requestInFlight.current || !hasMore) return;
    requestInFlight.current = true;
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    const offset = currentTurns.length + initialOffset;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ sourceId, sessionId, limit: String(PAGE_SIZE) });
      if (nextCursor) {
        params.set("cursor", nextCursor);
        params.delete("sourceId");
        params.delete("sessionId");
      }
      const response = await fetch(`/api/collection/transcript?${params.toString()}`, { cache: "no-store" });
      const result = await response.json() as TranscriptPage;
      if (generation !== requestGeneration.current) return;
      if (!response.ok) throw new Error(result.error ?? "Transcript window could not be loaded.");
      const nextTurns = result.turns ?? [];
      if (result.offset !== undefined && result.offset !== offset) {
        throw new Error("Transcript window offset changed; reload the transcript.");
      }
      const previousTotal = knownTotalRef.current;
      if (result.total !== undefined && (!isCount(result.total) || result.total < offset || result.total < currentTurns.length)) {
        throw new Error("Transcript changed on disk; reload the transcript.");
      }
      if (nextTurns.length === 0 && (result.total ?? offset) > offset) {
        throw new Error("Transcript window made no progress; reload the transcript.");
      }
      const current = loadedTurnsRef.current;
      if (current.length + initialOffset !== offset) {
        throw new Error("Transcript window changed while loading; reload the transcript.");
      }
      const next = [...current, ...nextTurns];
      const nextTotal = Math.max(result.total ?? next.length, next.length);
      loadedTurnsRef.current = next;
      knownTotalRef.current = nextTotal;
      setLoadedTurns(next);
      setCheckpoints(previous => [...previous, { offset, cursor: result.windowCursor }]);
      setKnownTotal(nextTotal);
      setNextCursor(result.nextCursor ?? null);
      setHasMore(result.hasMore === true && result.nextCursor != null);
      setKnownCounts({
        ...countTurns(next),
        all: nextTotal,
        ...(result.counts?.chat !== undefined && isCount(result.counts.chat) ? { chat: result.counts.chat } : {}),
        ...(result.counts?.tools !== undefined && isCount(result.counts.tools) ? { tools: result.counts.tools } : {}),
        ...(result.counts?.errors !== undefined && isCount(result.counts.errors) ? { errors: result.counts.errors } : {}),
      });
      if (result.normalization) setKnownNormalization(result.normalization);
      if (result.total !== undefined && result.total > previousTotal) {
        setSourceNotice("Reached the end of this revision; total turn count is now confirmed.");
      }
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      setLoadError(error instanceof Error ? error.message : "Transcript window could not be loaded.");
    } finally {
      if (generation === requestGeneration.current) {
        requestInFlight.current = false;
        setLoadingMore(false);
      }
    }
  }

  // Invisible-speed: prefetch the next window when the reader approaches the end of
  // the loaded transcript. The manual Load-next button remains for explicit control;
  // the sentinel just removes the wait. Guarded so only one fetch is ever in flight.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loadingMore || initialTargetIndex !== undefined) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !requestInFlight.current) {
          void loadMoreStable();
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loadMoreStable, initialTargetIndex]);

  return (
    <div>
      <TranscriptSearch sourceId={sourceId} sessionId={sessionId} />
      {initialOffset > 0 && <p className="text-xs text-fg-muted mb-3">Context window starting at message {initialOffset + 1}. <a className="underline" href={`?sourceId=${encodeURIComponent(sourceId)}&sessionId=${encodeURIComponent(sessionId)}`}>Read from the beginning</a></p>}
      <div
        className="sticky top-2 z-20 -mx-2 mb-3 space-y-2 rounded-lg border border-bd bg-bg/95 p-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-bg/80"
      >
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="mr-1 text-[10px] font-medium uppercase tracking-[0.12em] text-fg-dim">View</span>
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
        <span className="ml-auto hidden text-[10px] text-fg-dim sm:inline">
          {filter === "chat" ? "Conversation first" : filter === "tools" ? "Tool evidence" : filter === "errors" ? "Error signals" : "All normalized events"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-fg-dim" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter loaded messages…"
            className="w-36 sm:w-44 pl-7 pr-6 py-1 text-[11px] bg-bg border border-bd rounded-full focus:outline-none focus:border-accent placeholder:text-fg-dim transition-[border-color]"
            aria-label="Filter loaded transcript messages"
          />
          {q && (
            <button onClick={() => setQ("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-fg-dim hover:text-fg" aria-label="Clear search">
              <X className="size-3" />
            </button>
          )}
        </div>
        {dq && (
          <div className="flex min-w-0 basis-full items-center gap-1 text-[10px] text-fg-dim mono tabular-nums whitespace-nowrap sm:basis-auto">
            <span className="min-w-0 truncate" role="status" aria-live="polite">{fmtNum(visible.length)} match{visible.length === 1 ? "" : "es"} in loaded turns</span>
            {matchIndexes.length > 0 && (
              <>
                <span className="sr-only">Use previous and next match controls to navigate.</span>
                <button
                  type="button"
                  onClick={() => jumpToMatch(-1)}
                  disabled={matchPos <= 0}
                  aria-label="Previous transcript match"
                  className="grid min-h-8 min-w-8 place-items-center rounded-md border border-bd hover:bg-bg-elev disabled:opacity-40"
                >
                  <ChevronUp className="size-3" />
                </button>
                <span aria-hidden="true">{matchPos >= 0 ? `${matchPos + 1}/${matchIndexes.length}` : "Jump"}</span>
                <button
                  type="button"
                  onClick={() => jumpToMatch(1)}
                  disabled={matchPos >= matchIndexes.length - 1}
                  aria-label="Next transcript match"
                  className="grid min-h-8 min-w-8 place-items-center rounded-md border border-bd hover:bg-bg-elev disabled:opacity-40"
                >
                  <ChevronDown className="size-3" />
                </button>
              </>
            )}
          </div>
        )}
        <RedactToggle compact redact={redact} onToggle={() => setRedact((v) => !v)} />
      </div>
      {knownNormalization && (knownNormalization.suppressedMirrors > 0 || knownNormalization.compoundRecords > 0) && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-bd bg-bg-elev px-3 py-2 text-[11px] text-fg-muted" role="status">
          <ScanLine className="mt-0.5 size-3.5 shrink-0 text-accent-soft" />
          <span>
            Normalized view
            {knownNormalization.suppressedMirrors > 0 && <> · {fmtNum(knownNormalization.suppressedMirrors)} mirrored protocol cop{knownNormalization.suppressedMirrors === 1 ? "y" : "ies"} hidden</>}
            {knownNormalization.compoundRecords > 0 && <> · {fmtNum(knownNormalization.compoundRecords)} compound record{knownNormalization.compoundRecords === 1 ? "" : "s"} split into individual turns</>}
            {" · "}raw transcript unchanged
          </span>
        </div>
      )}
      </div>

      {/* Hops over the errors VISIBLE under the current filter/search — ids keep
          original indexes, so anchors always exist. Key resets its cursor when
          the visible set changes shape. */}
      {visibleErrorIdx.length > 0 && <ErrorHopper key={`${filter}:${dq}`} errorTurnIndexes={visibleErrorIdx} />}

      <div className="space-y-1">
            {rendered.length === 0 && (
              <div className="card p-6 text-center text-sm text-fg-dim">
                {dq
                  ? loadedTurns.length < knownTotal
                    ? "No matches in the loaded window. Load next to continue searching."
                    : "No matches in this transcript."
                  : counts[filter] > 0 ? "No matching turns in the shown window." : "Nothing matches this filter."}
              </div>
            )}
        {rendered.map(({ t, i, label, preview }) => {
          const meta = t.role === "meta" && t.severity === "info";
          const agentReasoning = isAgentReasoningTurn(t);
          return (
            <div key={i} id={`turn-${i}`} className={clsx((initialTargetIndex === undefined || i >= initialOffset + turns.length) && (meta ? "cv-auto" : "cv-auto-lg"), "card border rounded-md transcript-message", SEVERITY_TONE[t.severity], roleTone(t), agentReasoning ? "border-accent/30 bg-accent/[0.02] p-0" : meta ? "px-3 py-1" : "px-3 py-2")}>
              {agentReasoning ? (
                <AgentReasoningBlock preview={preview} at={t.at} mounted={mounted} />
              ) : (
                <>
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
                    <a className="text-[10px] text-fg-muted underline" href={(() => { const params = new URLSearchParams(typeof window === "undefined" ? { sourceId, sessionId } : window.location.search); const checkpoint = [...checkpoints].reverse().find(c => c.offset <= i); if (checkpoint?.cursor) params.set("window", checkpoint.cursor); params.set("turn", String(i)); return `?${params}#turn-${i}`; })()} onClick={() => setFilter("all")}>#{i + 1}</a>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {t.tool?.callId && <a className="text-[10px] text-accent-soft underline" href={(() => { const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search); params.set("sourceId", sourceId); params.set("sessionId", sessionId); params.set("search", t.tool!.callId!); params.delete("window"); params.delete("turn"); return `?${params}`; })()}>Find paired call / result</a>}
                      {t.tool?.status && (
                        <span className="rounded border border-bd px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-fg-dim">
                          {show(t.tool.status)}
                        </span>
                      )}
                      {t.tool && (
                        <span className="rounded border border-accent/20 bg-accent/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-accent-soft" title={t.tool.callId ? `Call ${show(t.tool.callId)}` : undefined}>
                          {t.tool.phase === "call" ? "call" : "result"}
                        </span>
                      )}
                      {(t.media?.images ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-1 rounded border border-bd px-1.5 py-0.5 text-[9px] text-fg-dim">
                          <ImageIcon className="size-2.5" />
                          {fmtNum(t.media?.images ?? 0)} image{t.media?.images === 1 ? "" : "s"}
                        </span>
                      )}
                      {(t.media?.files ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-1 rounded border border-bd px-1.5 py-0.5 text-[9px] text-fg-dim">
                          <FileIcon className="size-2.5" />
                          {fmtNum(t.media?.files ?? 0)} file{t.media?.files === 1 ? "" : "s"}
                        </span>
                      )}
                      {t.tool?.durationMs != null && (
                        <span className="text-[10px] text-fg-dim mono tabular-nums" title={t.tool.callId ? `Call ${show(t.tool.callId)}` : undefined}>
                          {t.tool.durationMs < 1000 ? `${t.tool.durationMs}ms` : `${(t.tool.durationMs / 1000).toFixed(1)}s`}
                        </span>
                      )}
                      {t.at ? (
                        <time
                          className="text-[10px] text-fg-dim mono tabular-nums"
                          dateTime={fmtStableDateTime(t.at)}
                          title={fmtDateTime(t.at)}
                        >
                          {mounted ? fmtTime(t.at) : fmtStableDateTime(t.at)}
                        </time>
                      ) : null}
                    </span>
                  </div>
                  {preview && (meta ? (
                    <div className="text-[11px] mono text-fg-dim truncate">{preview}</div>
                  ) : (
                    <TranscriptContent text={preview} query={dq} tool={t.role === "tool"} />
                  ))}
                </>
              )}
            </div>
          );
        })}
      </div>
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      {hasMore && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-md border border-bd px-3 py-1.5 text-xs text-fg-muted hover:bg-bg-elev hover:text-fg disabled:opacity-60"
          >
            {loadingMore && <Loader2 className="size-3.5 animate-spin" />}
                {loadingMore
                  ? "Loading transcript…"
                  : `Load next ${fmtNum(PAGE_SIZE)} turns${dq ? " to continue search" : ""}`}
          </button>
          <p className="text-[10px] text-fg-dim mono tabular-nums">Showing {fmtNum(loadedTurns.length)} parsed turns{hasMore ? " · more available" : ""}</p>
          {loadError && (
            <p className="text-[11px] text-err" role="alert">
              {show(loadError)}
              {/reload/i.test(loadError) && (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="underline hover:text-fg"
                  >
                    Reload transcript
                  </button>
                </>
              )}
            </p>
          )}
        </div>
      )}
      {sourceNotice && <p className="mt-3 text-center text-[11px] text-fg-dim" role="status">{show(sourceNotice)}</p>}
    </div>
  );
}
