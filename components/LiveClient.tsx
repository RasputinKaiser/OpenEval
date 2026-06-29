"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import clsx from "clsx";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownWideNarrow,
  BarChart3,
  Clock3,
  Cpu,
  Eye,
  FileText,
  Filter,
  FolderGit2,
  Gauge,
  GitBranch,
  GitFork,
  Inbox,
  Layers,
  Loader2,
  Lock,
  MessageSquareText,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Timer,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import HarnessPicker from "./HarnessPicker";
import { compactDisplayPath, redactSensitiveText } from "@/lib/redaction";
import type { LiveAggregate, LiveMetricSources, LiveSession, LiveTranscriptTurn, MetricSource, TranscriptResult } from "@/lib/live";
import { useFocusOnSlash } from "@/lib/use-focus-slash";

type LiveClientProps = {
  initialData?: LiveAggregate | null;
  error?: string;
  getTranscript?: (filePath: string, harness?: string) => Promise<TranscriptResult>;
};

type FilterMode = "all" | "attention" | "stale" | "missing";
type SortMode = "recent" | "quality" | "errors";

const REDACT_STORAGE_KEY = "neval.live.redactUsernames";
const HARNESS_STORAGE_KEY = "neval.live.harness";

function defaultLiveLimitForHarnessClient(harness: string): number {
  return harness === "codex" ? 50 : 200;
}

export default function LiveClient({ initialData, error: initialError, getTranscript }: LiveClientProps) {
  const [data, setData] = useState<LiveAggregate | null>(initialData ?? null);
  const [error, setError] = useState<string | undefined>(initialError);
  const [loading, setLoading] = useState(!initialData && !initialError);
  const [selected, setSelected] = useState<LiveSession | null>(null);
  const [selectedHarness, setSelectedHarness] = useState(initialData?.sourceHarness ?? "ncode");
  const [redact, setRedact] = useState(true);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sort, setSort] = useState<SortMode>("recent");
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useFocusOnSlash(searchRef);

  const lastSigRef = useRef("");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(REDACT_STORAGE_KEY);
      if (stored === "0") setRedact(false);
      if (stored === "1") setRedact(true);
      const url = new URL(window.location.href);
      const urlHarness = url.searchParams.get("harness");
      const storedHarness = window.localStorage.getItem(HARNESS_STORAGE_KEY);
      if (urlHarness) setSelectedHarness(urlHarness);
      else if (storedHarness) setSelectedHarness(storedHarness);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(REDACT_STORAGE_KEY, redact ? "1" : "0");
    } catch {}
  }, [redact]);

  useEffect(() => {
    try {
      window.localStorage.setItem(HARNESS_STORAGE_KEY, selectedHarness);
      const url = new URL(window.location.href);
      if (selectedHarness === "ncode") url.searchParams.delete("harness");
      else url.searchParams.set("harness", selectedHarness);
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {}
  }, [selectedHarness]);

  useEffect(() => {
    let cancelled = false;
    let t: ReturnType<typeof setTimeout>;
    let activeController: AbortController | null = null;
    const poll = async () => {
      const controller = new AbortController();
      activeController = controller;
      try {
        const limit = defaultLiveLimitForHarnessClient(selectedHarness);
        const response = await fetch(`/api/live?harness=${encodeURIComponent(selectedHarness)}&limit=${limit}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Live poll failed: HTTP ${response.status}`);
        const d = (await response.json()) as LiveAggregate;
        if (!cancelled) {
          const sig = `${d.sourceHarness}:${d.sourceStatus}:${d.totalSessions}:${d.totalToolCalls}:${d.totalToolErrors}:${d.usageSummary.totalTokens}:${d.sessions[0]?.sessionId ?? ""}:${d.avgDataQuality}`;
          if (sig !== lastSigRef.current) {
            lastSigRef.current = sig;
            setData(d);
          }
          if (d.totalSessions > 0) setError(undefined);
        }
      } catch (e) {
        if (!cancelled && !(e instanceof DOMException && e.name === "AbortError")) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (activeController === controller) activeController = null;
        if (!cancelled) {
          setLoading(false);
          t = setTimeout(poll, 10000);
        }
      }
    };
    poll();
    return () => {
      cancelled = true;
      activeController?.abort();
      clearTimeout(t);
    };
  }, [selectedHarness]);

  const visibleSessions = useMemo(() => {
    const sessions = data?.sessions ?? [];
    const q = search.trim().toLowerCase();
    const filtered = sessions.filter((session) => {
      if (filter === "attention" && !needsAttention(session)) return false;
      if (filter === "stale" && !(session.staleMs > staleThresholdMs())) return false;
      if (filter === "missing" && !Object.values(session.metricSources).some((source) => source === "missing" || source === "malformed")) return false;
      if (q) {
        const hay = `${session.sessionId} ${session.project} ${session.displayTitle ?? ""} ${session.model ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (sort === "quality") return a.dataQuality - b.dataQuality || b.lastEventAt - a.lastEventAt;
      if (sort === "errors") return b.toolErrors - a.toolErrors || b.hookErrors - a.hookErrors || b.lastEventAt - a.lastEventAt;
      return b.lastEventAt - a.lastEventAt;
    });
  }, [data, filter, sort, search]);

  if (loading && !data) return <LoadingSkeleton />;
  if (!data) return error ? <ErrorCard message={error} /> : <EmptyCard warnings={[]} />;

  const toolErrorRate = data.totalToolCalls > 0 ? data.totalToolErrors / data.totalToolCalls : 0;
  const modelEvidenceLabel = data.sessionsWithMissingModel ? "Unknown model" : "Inferred model";
  const modelEvidenceValue = data.sessionsWithMissingModel ? data.sessionsWithMissingModel : data.sessionsWithInferredModel;
  const modelEvidenceTone = data.sessionsWithMissingModel ? "warn" : undefined;

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-normal">
            <Activity className="size-6 text-accent-soft" /> Live sessions
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-fg-muted">
            Live trace sessions from <code className="mono text-xs">{displayText(data.sourceRoots[0] ?? data.sourceLabel, redact)}</code>, with usage
            provenance, parser confidence, and copy-safe redaction for local usernames.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-80">
          <HarnessPicker value={selectedHarness === "ncode" ? undefined : selectedHarness} onChange={(harness) => {
            setSelected(null);
            setSelectedHarness(harness || "ncode");
          }} />
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <button
            type="button"
            onClick={() => setRedact((value) => !value)}
            className={clsx(
              "inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium",
              redact ? "border-ok/30 bg-ok/10 text-ok" : "border-warn/30 bg-warn/10 text-warn"
            )}
          >
            {redact ? <Lock className="size-4" /> : <Eye className="size-4" />}
            REDACT {redact ? "ON" : "OFF"}
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-md border border-bd bg-bg-elev px-3 py-2 text-xs text-fg-muted hover:text-fg"
          >
            <RefreshCw className="size-4" /> Refresh
          </button>
          </div>
        </div>
      </header>

      {data.sourceStatus !== "available" && (
        <div className="mb-4 rounded-lg border border-warn/30 bg-warn/10 p-3 text-sm text-warn">
          {displayText(data.sourceMessage ?? "No live trace source is available for this harness.", redact)}
        </div>
      )}

      {data.scanWarnings.length > 0 && (
        <div className="mb-4 rounded-lg border border-warn/30 bg-warn/10 p-3 text-sm text-warn">
          {data.scanWarnings.map((warning) => <div key={warning}>{displayText(warning, redact)}</div>)}
        </div>
      )}

      <UsageStrip data={data} />

      <section className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricGroup label="Population">
          <Stat label="Sessions" value={String(data.totalSessions)} icon={Activity} />
          <Stat label="Measured dur" value={`${data.sessionsWithMeasuredDuration}/${data.totalSessions}`} icon={Timer} />
        </MetricGroup>
        <MetricGroup label="Quality">
          <Stat label="Quality" value={`${Math.round(data.avgDataQuality)}%`} icon={Gauge} tone={qualityTone(data.avgDataQuality)} />
          <Stat label={modelEvidenceLabel} value={String(modelEvidenceValue)} icon={Cpu} tone={modelEvidenceTone} />
          <Stat label="Tokens missing" value={String(data.sessionsWithMissingTokens)} icon={Layers} tone={data.sessionsWithMissingTokens ? "warn" : undefined} />
        </MetricGroup>
        <MetricGroup label="Health">
          <Stat label="Tool err rate" value={`${Math.round(toolErrorRate * 100)}%`} icon={AlertTriangle} tone={toolErrorRate ? "err" : undefined} />
          <Stat label="Stale" value={String(data.staleSessions)} icon={Clock3} tone={data.staleSessions ? "warn" : undefined} />
          <Stat label="Malformed" value={String(data.sessionsWithMalformedLines)} icon={ShieldAlert} tone={data.sessionsWithMalformedLines ? "err" : undefined} />
        </MetricGroup>
      </section>

      <section className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_1.8fr]">
        <ModelPanel data={data} />
        <section className="card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-bd-subtle px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                <FolderGit2 className="size-4 text-fg-muted" /> Recent sessions
              </div>
              <div className="mt-1 text-xs text-fg-muted">
                {visibleSessions.length}/{data.sessions.length} shown · values marked missing are not treated as zero-confidence measurements
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <SelectPill icon={Filter} value={filter} onChange={(v) => setFilter(v as FilterMode)} options={[
                ["all", "All"],
                ["attention", "Attention"],
                ["stale", "Stale"],
                ["missing", "Missing"],
              ]} />
              <SelectPill icon={ArrowDownWideNarrow} value={sort} onChange={(v) => setSort(v as SortMode)} options={[
                ["recent", "Recent"],
                ["quality", "Quality"],
                ["errors", "Errors"],
              ]} />
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-fg-dim" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="w-32 lg:w-44 pl-8 pr-2 py-1.5 text-[11px] bg-bg border border-bd rounded-md focus:outline-none focus:border-accent focus:w-40 lg:focus:w-52 transition-all placeholder:text-fg-dim"
                />
              </div>
            </div>
          </div>

          <div className="hidden grid-cols-[minmax(220px,1.7fr)_90px_100px_100px_90px_80px] gap-3 border-b border-bd-subtle bg-bg-subtle px-4 py-2 text-[10px] uppercase tracking-wider text-fg-muted md:grid">
            <div>Session / project</div>
            <div>Freshness</div>
            <div>Quality</div>
            <div>Sources</div>
            <div className="text-right">Tools</div>
            <div className="text-right">Status</div>
          </div>

          <div className="max-h-[64vh] overflow-y-auto divide-y divide-bd-subtle">
            {visibleSessions.map((session) => (
              <SessionRow
                key={session.sessionId + session.project}
                session={session}
                redact={redact}
                onClick={() => setSelected(session)}
              />
            ))}
            {visibleSessions.length === 0 && (
              <div className="p-8 text-center text-sm text-fg-muted">No sessions match the current filter.</div>
            )}
          </div>
        </section>
      </section>

      <TraceIntelligencePanels data={data} redact={redact} />

      {selected && (
        <SessionDrawer
          session={selected}
          redact={redact}
          onClose={() => setSelected(null)}
          getTranscript={getTranscript}
          harness={data.sourceHarness}
        />
      )}
    </div>
  );
}

function ModelPanel({ data }: { data: LiveAggregate }) {
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-bd-subtle px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <BarChart3 className="size-4 text-fg-muted" /> Model evidence
        </div>
        <div className="mt-1 text-xs text-fg-muted">
          Inferred rows use the Noumena Code/ncode default; unknown rows mean the trace did not report model metadata.
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-bg-subtle text-[10px] uppercase tracking-wider text-fg-muted">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Model</th>
              <th className="px-4 py-2 text-right font-medium">Sessions</th>
              <th className="px-4 py-2 text-right font-medium">Quality</th>
              <th className="px-4 py-2 text-right font-medium">Missing</th>
              <th className="px-4 py-2 text-right font-medium">Errors</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bd-subtle">
            {data.byModel.map((model) => (
              <tr key={model.model} className="hover:bg-bg-elev">
                <td className="px-4 py-2">
                  <span className="mono text-xs">{model.model}</span>
                </td>
                <td className="px-4 py-2 text-right mono tabular-nums">{model.sessions}</td>
                <td className="px-4 py-2 text-right">
                  <QualityBadge value={model.avgDataQuality} />
                </td>
                <td className="px-4 py-2 text-right text-xs text-fg-muted">
                  {model.missingTokens + model.missingCost ? `${model.missingTokens} token / ${model.missingCost} cost` : "—"}
                </td>
                <td className={clsx("px-4 py-2 text-right mono tabular-nums", model.errors > 0 && "text-err")}>{model.errors}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TraceIntelligencePanels({ data, redact }: { data: LiveAggregate; redact: boolean }) {
  const queueTotal = data.queueTotals.enqueue + data.queueTotals.dequeue + data.queueTotals.remove + data.queueTotals.popAll;
  return (
    <section className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-4">
      <section className="card overflow-hidden">
        <PanelHeader icon={GitFork} title="Execution graph" subtitle="Root thread, sidechains, and agents." />
        <div className="grid grid-cols-3 gap-2 p-4">
          <TinyMetric label="Sidechain msgs" value={fmt(data.sidechainMessages)} />
          <TinyMetric label="Agent sessions" value={fmt(data.agentSessions)} />
          <TinyMetric label="Projects" value={fmt(data.totalProjects)} />
        </div>
        <div className="border-t border-bd-subtle px-4 py-3">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-fg-muted">Top branches</div>
          <ListStack items={data.topBranches.map((branch) => ({
            key: branch.branch,
            label: branch.branch,
            value: `${branch.sessions} sessions`,
          }))} redact={redact} empty="No branch metadata found." />
        </div>
      </section>

      <section className="card overflow-hidden">
        <PanelHeader icon={Wrench} title="Tool reliability" subtitle="Tool mix and error concentration." />
        <div className="divide-y divide-bd-subtle">
          {data.byTool.slice(0, 6).map((tool) => (
            <div key={tool.name} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2 text-sm">
              <span className="truncate">{tool.name}</span>
              <span className="mono tabular-nums text-xs text-fg-muted">{tool.calls}</span>
              <span className={clsx("mono tabular-nums text-xs", tool.errors ? "text-err" : "text-fg-dim")}>{tool.errors} err</span>
            </div>
          ))}
          {data.byTool.length === 0 && <div className="p-4 text-sm text-fg-muted">No tool calls found.</div>}
        </div>
      </section>

      <section className="card overflow-hidden">
        <PanelHeader icon={Zap} title="Operator queue" subtitle="Queued prompts and interruption flow." />
        <div className="grid grid-cols-4 gap-2 p-4">
          <TinyMetric label="Total" value={fmt(queueTotal)} />
          <TinyMetric label="Enq" value={fmt(data.queueTotals.enqueue)} />
          <TinyMetric label="Deq" value={fmt(data.queueTotals.dequeue)} />
          <TinyMetric label="Drop" value={fmt(data.queueTotals.remove + data.queueTotals.popAll)} />
        </div>
        <div className="border-t border-bd-subtle px-4 py-3">
          <ListStack items={data.queueTotals.preview.map((preview, index) => ({
            key: `${index}-${preview}`,
            label: preview,
          }))} redact={redact} empty="No queued prompt previews." />
        </div>
      </section>

      <section className="card overflow-hidden">
        <PanelHeader icon={FileText} title="File / repo impact" subtitle="Touched files inferred from tools and snapshots." />
        <div className="border-b border-bd-subtle px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            <GitBranch className="size-3.5" />
            {data.topBranches[0]?.branch ?? "branch missing"}
          </div>
        </div>
        <div className="px-4 py-3">
          <ListStack items={data.topFiles.slice(0, 6).map((file) => ({
            key: file.file,
            label: compactDisplayPath(file.file, redact),
            value: `${file.sessions} sessions`,
          }))} redact={false} empty="No touched files inferred." />
        </div>
      </section>
    </section>
  );
}

function UsageStrip({ data }: { data: LiveAggregate }) {
  const usage = data.usageSummary;
  const tokenMeasured = usage.sessionsWithMeasuredUsage;
  const costMeasured = usage.sessionsWithMeasuredCost;
  const measuredTone = tokenMeasured === data.totalSessions && data.totalSessions > 0 ? "ok" : tokenMeasured > 0 ? "warn" : "warn";
  return (
    <section className="mb-6 card overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-bd-subtle px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <Cpu className="size-4 text-fg-muted" /> Usage
          </div>
          <div className="mt-1 text-xs text-fg-muted">
            Tokens and cost are shown only when the selected trace source reports them.
          </div>
        </div>
        <div className={clsx(
          "inline-flex w-fit items-center gap-1 rounded border px-2 py-1 text-[10px] uppercase tracking-wider",
          measuredTone === "ok" ? "border-ok/30 bg-ok/10 text-ok" : "border-warn/30 bg-warn/10 text-warn"
        )}>
          {tokenMeasured}/{data.totalSessions} usage measured
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 lg:grid-cols-3">
        <MetricGroup label="Volume">
          <TinyMetric label="Total tok" value={usage.totalTokens ? fmt(usage.totalTokens) : "missing"} />
          <TinyMetric label="Input" value={usage.totalInputTokens ? fmt(usage.totalInputTokens) : "missing"} />
          <TinyMetric label="Output" value={usage.totalOutputTokens ? fmt(usage.totalOutputTokens) : "missing"} />
        </MetricGroup>
        <MetricGroup label="Cache">
          <TinyMetric label="Cache read" value={usage.totalCacheReadTokens ? fmt(usage.totalCacheReadTokens) : "missing"} />
          <TinyMetric label="Cache create" value={usage.totalCacheCreateTokens ? fmt(usage.totalCacheCreateTokens) : "missing"} />
          <TinyMetric label="Coverage" value={`${Math.round(usage.tokenCoverage * 100)}%`} />
        </MetricGroup>
        <MetricGroup label="Cost & rate">
          <TinyMetric label="Cost" value={costMeasured ? `$${usage.totalCostUsd.toFixed(4)}` : "missing"} />
          <TinyMetric label="Out tok/s" value={usage.avgOutputTokPerSec ? usage.avgOutputTokPerSec.toFixed(1) : "missing"} />
        </MetricGroup>
      </div>
      {data.totalSessions > 0 && tokenMeasured === 0 && (
        <div className="border-t border-bd-subtle px-4 py-3 text-xs text-warn">
          This source currently has no measured token usage in the scanned sessions; values are marked missing instead of treated as zero.
        </div>
      )}
    </section>
  );
}

function PanelHeader({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle: string }) {
  return (
    <div className="border-b border-bd-subtle px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="size-4 text-fg-muted" /> {title}
      </div>
      <div className="mt-1 text-xs text-fg-muted">{subtitle}</div>
    </div>
  );
}

function TinyMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-fg-muted truncate">{label}</span>
      <span className="mono text-xs font-semibold tabular-nums text-fg">{value}</span>
    </div>
  );
}

function DetailPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-bd bg-bg/45 p-4">
      <div className="mb-3 text-sm font-medium">{title}</div>
      {children}
    </section>
  );
}

function ListStack({ items, redact, empty }: { items: Array<{ key: string; label: string; value?: string }>; redact: boolean; empty: string }) {
  if (items.length === 0) return <div className="text-sm text-fg-muted">{empty}</div>;
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.key} className="flex min-w-0 items-center justify-between gap-3 text-xs">
          <span className="truncate text-fg-muted">{displayText(item.label, redact)}</span>
          {item.value ? <span className="mono shrink-0 text-[10px] text-fg-dim">{item.value}</span> : null}
        </div>
      ))}
    </div>
  );
}

function SessionRow({ session, redact, onClick }: { session: LiveSession; redact: boolean; onClick: () => void }) {
  const attention = needsAttention(session);
  const edgeColor = session.isError || session.toolErrors > 0 ? "bg-err" : session.hookErrors > 0 ? "bg-warn" : attention ? "bg-warn/50" : session.staleMs > staleThresholdMs() ? "bg-fg-dim" : "bg-ok/40";
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "relative grid w-full gap-3 pl-4 pr-4 py-3 text-left transition-colors hover:bg-bg-elev md:grid-cols-[minmax(220px,1.7fr)_90px_100px_100px_90px_80px] md:items-center",
        attention && "bg-warn/5"
      )}
    >
      <div className={clsx("absolute left-0 top-2 bottom-2 w-0.5 rounded-full", edgeColor)} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          {attention ? <ShieldAlert className="size-4 shrink-0 text-warn" /> : <ShieldCheck className="size-4 shrink-0 text-ok" />}
          <span className="truncate text-sm font-medium">{compactDisplayPath(session.project || "(unknown)", redact)}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-fg-dim">
          <span className="mono">{shortId(session.sessionId)}</span>
          <span>·</span>
          {session.displayTitle ? (
            <>
              <span>{displayText(session.displayTitle, redact)}</span>
              <span>·</span>
            </>
          ) : null}
          <span>{session.model || "model missing"}</span>
          {session.traceGraph.sidechainMessages > 0 ? <span className="rounded bg-accent/10 px-1.5 py-0.5 text-accent-soft">{session.traceGraph.sidechainMessages} side</span> : null}
          {session.traceGraph.agentCount > 0 ? <span className="rounded bg-bg-elev px-1.5 py-0.5 text-fg-muted">{session.traceGraph.agentCount} agent</span> : null}
          {session.modeSummary.gitBranch ? <span className="rounded bg-bg-elev px-1.5 py-0.5 text-fg-muted">{displayText(session.modeSummary.gitBranch, redact)}</span> : null}
          <span className={clsx(
            "rounded px-1.5 py-0.5 tabular-nums",
            session.metricSources.tokens === "measured" ? "bg-ok/10 text-ok" : "bg-warn/10 text-warn"
          )}>
            {session.metricSources.tokens === "measured" ? `${fmt(session.totalTokens)} tok` : "usage missing"}
          </span>
          {session.parseWarnings.slice(0, 2).map((warning) => (
            <span key={warning} className="rounded bg-warn/10 px-1.5 py-0.5 text-warn">{displayText(warning, redact)}</span>
          ))}
        </div>
      </div>
      <div className="text-xs text-fg-muted md:text-left">
        <div>{relativeTime(session.lastEventAt)}</div>
        <div className="mono text-[10px] tabular-nums text-fg-dim">{fmtMs(session.durationMs)}</div>
      </div>
      <QualityBadge value={session.dataQuality} />
      <div className="flex flex-wrap gap-1">
        <SourceChip label="model" source={session.metricSources.model} />
        <SourceChip label="tok" source={session.metricSources.tokens} />
        <SourceChip label="dur" source={session.metricSources.duration} />
      </div>
      <div className="flex items-center gap-2 text-xs md:justify-end">
        <span className="mono inline-flex items-center gap-1 text-fg-muted"><Wrench className="size-3" />{session.toolCalls}</span>
        <span className={clsx("mono inline-flex items-center gap-1", session.toolErrors > 0 ? "text-err" : "text-fg-muted")}>
          <AlertTriangle className="size-3" />{session.toolErrors}
        </span>
      </div>
      <StatusPill session={session} />
    </button>
  );
}

function SessionDrawer({
  session,
  redact,
  onClose,
  getTranscript,
  harness,
}: {
  session: LiveSession;
  redact: boolean;
  onClose: () => void;
  getTranscript?: (filePath: string, harness?: string) => Promise<TranscriptResult>;
  harness: string;
}) {
  const [turns, setTurns] = useState<LiveTranscriptTurn[] | null>(null);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (closing) return;
      setClosing(true);
      setTimeout(() => onCloseRef.current(), 180);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closing]);

  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => onCloseRef.current(), 180);
  };

  useEffect(() => {
    let cancelled = false;
    if (!getTranscript || !session.path) {
      if (!cancelled) setTurns([]);
      return;
    }
    setTurns(null);
    setTranscriptError(null);
    getTranscript(session.path, harness)
      .then((res) => {
        if (cancelled) return;
        if (res.error) {
          setTranscriptError(`Failed to parse session transcript: ${res.error}`);
          setTurns([]);
        } else {
          setTurns(res.turns);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setTranscriptError(`Failed to parse session transcript: ${e instanceof Error ? e.message : String(e)}`);
          setTurns([]);
        }
      });
    return () => { cancelled = true; };
  }, [session, getTranscript, harness]);

  const visible = mounted && !closing;
  const durationByName = new Map(session.toolDurations.map((d) => [d.name, d] as const));

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/50 transition-opacity duration-200 ease-out"
        onClick={requestClose}
        style={{ opacity: visible ? 1 : 0 }}
      />
      <div
        className="relative flex h-full w-full flex-col overflow-hidden border-l border-bd bg-bg-subtle shadow-2xl md:max-w-2xl"
        style={{
          transform: visible ? "translateX(0)" : "translateX(16px)",
          opacity: visible ? 1 : 0,
          transition: "transform 200ms cubic-bezier(0.2, 0, 0, 1), opacity 200ms cubic-bezier(0.2, 0, 0, 1)",
        }}
      >
        <div className="border-b border-bd-subtle bg-bg-subtle px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">Session details</h2>
                <QualityBadge value={session.dataQuality} />
                <StatusPill session={session} />
              </div>
              <p className="mono mt-1 break-all text-xs text-fg-muted">{displayText(session.sessionId, redact)}</p>
            </div>
            <button type="button" onClick={requestClose} className="rounded min-h-10 min-w-10 flex items-center justify-center hover:bg-bg-elev">
              <X className="size-5 text-fg-muted" />
            </button>
          </div>
        </div>

        <div className="drawer-stagger flex-1 space-y-5 overflow-y-auto p-5">
          <section className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <MetricCard label="Project" value={compactDisplayPath(session.project || "(unknown)", redact)} />
            <MetricCard label="Model" value={session.model || "missing"} source={session.metricSources.model} />
            <MetricCard label="Duration" value={session.metricSources.duration === "missing" ? "missing" : fmtMs(session.durationMs)} source={session.metricSources.duration} />
            <MetricCard label="Tokens" value={session.metricSources.tokens === "missing" ? "missing" : fmt(session.inputTokens + session.outputTokens)} source={session.metricSources.tokens} />
          </section>

          <DetailPanel title="Usage">
            <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2">
              <TinyMetric label="Input" value={session.metricSources.tokens === "measured" ? fmt(session.inputTokens) : "missing"} />
              <TinyMetric label="Output" value={session.metricSources.tokens === "measured" ? fmt(session.outputTokens) : "missing"} />
              <TinyMetric label="Cache read" value={session.metricSources.tokens === "measured" ? fmt(session.cacheReadTokens) : "missing"} />
              <TinyMetric label="Cache create" value={session.metricSources.tokens === "measured" ? fmt(session.cacheCreateTokens) : "missing"} />
              <TinyMetric label="Cost" value={session.metricSources.cost === "measured" ? `$${session.costUsd.toFixed(4)}` : "missing"} />
            </div>
            {session.usageSegments.length > 0 ? (
              <UsageTimeline session={session} />
            ) : (
              <div className="rounded border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
                Usage timeline unavailable because this trace did not report token segment data.
              </div>
            )}
          </DetailPanel>

          {(session.displayTitle || session.lastPromptPreview) && (
            <section className="rounded-lg border border-bd bg-bg/45 p-4">
              <div className="mb-2 text-sm font-medium">Session intent</div>
              {session.displayTitle ? <div className="text-sm text-fg">{displayText(session.displayTitle, redact)}</div> : null}
              {session.lastPromptPreview ? (
                <pre className="mono mt-2 max-h-28 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-fg-muted">
                  {displayText(session.lastPromptPreview, redact)}
                </pre>
              ) : null}
            </section>
          )}

          <section className="rounded-lg border border-bd bg-bg/45 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-medium">Metric provenance</div>
              <div className="text-xs text-fg-muted">{session.lineCount} parsed lines · {fmtBytes(session.pathBytes)}</div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-3">
              {Object.entries(session.metricSources).map(([name, source]) => (
                <SourceCell key={name} label={name} source={source} />
              ))}
            </div>
            {session.parseWarnings.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {session.parseWarnings.map((warning) => (
                  <span key={warning} className="rounded border border-warn/30 bg-warn/10 px-2 py-1 text-[10px] text-warn">
                    {displayText(warning, redact)}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <MetricGroup label="Tooling">
              <MiniStat label="Tool calls" value={String(session.toolCalls)} icon={Wrench} />
              <MiniStat label="Tool errors" value={String(session.toolErrors)} icon={AlertTriangle} tone={session.toolErrors ? "err" : undefined} />
              <MiniStat label="Hook errors" value={String(session.hookErrors)} icon={ShieldAlert} tone={session.hookErrors ? "err" : undefined} />
            </MetricGroup>
            <MetricGroup label="Messages">
              <MiniStat label="Thinking" value={String(session.thinkingBlocks)} icon={Sparkles} />
              <MiniStat label="Text blocks" value={String(session.textBlocks)} icon={MessageSquareText} />
              <MiniStat label="Attachments" value={String(session.attachmentCount)} icon={Layers} />
            </MetricGroup>
            <MetricGroup label="History">
              <MiniStat label="Queue ops" value={String(session.queueOperationCount)} icon={Zap} tone={session.queueOperationCount ? "warn" : undefined} />
              <MiniStat label="Snapshots" value={String(session.snapshotCount)} icon={FolderGit2} />
            </MetricGroup>
          </section>

          <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <DetailPanel title="Execution graph">
              <div className="grid grid-cols-2 gap-2">
                <TinyMetric label="Root msgs" value={fmt(session.traceGraph.rootMessages)} />
                <TinyMetric label="Side msgs" value={fmt(session.traceGraph.sidechainMessages)} />
                <TinyMetric label="Agents" value={fmt(session.traceGraph.agentCount)} />
                <TinyMetric label="Orphans" value={fmt(session.traceGraph.orphanMessages)} />
              </div>
            </DetailPanel>
            <DetailPanel title="Modes / repo">
              <div className="space-y-2 text-xs text-fg-muted">
                <div className="flex justify-between gap-3"><span>Branch</span><span className="mono truncate">{displayText(session.modeSummary.gitBranch ?? "missing", redact)}</span></div>
                <div className="flex justify-between gap-3"><span>Entrypoint</span><span className="mono">{session.modeSummary.entrypoint ?? "missing"}</span></div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(session.modeSummary.permissionModes).map(([mode, count]) => (
                    <span key={mode} className="rounded bg-bg-elev px-1.5 py-0.5 text-[10px]">{mode}: {count}</span>
                  ))}
                </div>
              </div>
            </DetailPanel>
          </section>

          <DetailPanel title="Operator queue">
            <div className="mb-3 grid grid-cols-4 gap-2">
              <TinyMetric label="Enq" value={fmt(session.queueSummary.enqueue)} />
              <TinyMetric label="Deq" value={fmt(session.queueSummary.dequeue)} />
              <TinyMetric label="Rem" value={fmt(session.queueSummary.remove)} />
              <TinyMetric label="All" value={fmt(session.queueSummary.popAll)} />
            </div>
            <ListStack items={session.queueSummary.preview.map((preview, index) => ({
              key: `${index}-${preview}`,
              label: preview,
            }))} redact={redact} empty="No queued prompt previews." />
          </DetailPanel>

          <DetailPanel title="Tool breakdown">
            {session.toolSummaries.length === 0 ? (
              <div className="text-sm text-fg-muted">No tool calls found.</div>
            ) : (
              <>
                <div className="mb-3 grid grid-cols-[1fr_56px_56px_56px_56px_28px] gap-2 text-[9px] uppercase tracking-wider text-fg-dim">
                  <span>Tool</span>
                  <span className="text-right">calls</span>
                  <span className="text-right">p50</span>
                  <span className="text-right">p95</span>
                  <span className="text-right">max</span>
                  <span className="text-right">err</span>
                </div>
                <div className="space-y-1.5">
                  {session.toolSummaries.map((tool) => {
                    const dur = durationByName.get(tool.name);
                    return (
                      <div key={tool.name} className="grid grid-cols-[1fr_56px_56px_56px_56px_28px] items-center gap-2 py-1.5 text-xs">
                        <span className="truncate mono text-[11px] text-fg" title={tool.name}>{tool.name}</span>
                        <span className="mono tabular-nums text-right text-fg-muted">{tool.calls}</span>
                        <span className="mono tabular-nums text-right text-fg-muted">{dur ? fmtMs(dur.p50Ms) : "—"}</span>
                        <span className="mono tabular-nums text-right text-fg-muted">{dur ? fmtMs(dur.p95Ms) : "—"}</span>
                        <span className="mono tabular-nums text-right text-fg-dim">{dur ? fmtMs(dur.maxMs) : "—"}</span>
                        <span className={clsx("mono tabular-nums text-right", tool.errors > 0 ? "text-err" : "text-fg-dim")}>{tool.errors}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </DetailPanel>

          <DetailPanel title="File / repo impact">
            <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
              <TinyMetric label="Touched" value={fmt(session.fileActivity.touchedFiles.length)} />
              <TinyMetric label="Read-ish" value={fmt(session.fileActivity.readLikeOperations)} />
              <TinyMetric label="Write-ish" value={fmt(session.fileActivity.writeLikeOperations)} />
              <TinyMetric label="Snapshots" value={fmt(session.snapshotCount)} />
            </div>
            <ListStack items={session.fileActivity.touchedFiles.map((filePath) => ({
              key: filePath,
              label: compactDisplayPath(filePath, redact),
            }))} redact={false} empty="No file paths inferred from tools or snapshots." />
          </DetailPanel>

          <section>
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              Timeline context
              {turns === null && <Loader2 className="size-4 animate-spin text-fg-muted" />}
            </div>
            {transcriptError ? (
              <div className="rounded-lg border border-warn/30 bg-warn/10 p-4 text-sm text-warn">{displayText(transcriptError, redact)}</div>
            ) : turns === null ? (
              <LoadingSkeletonRows />
            ) : turns.length === 0 ? (
              <div className="rounded-lg border border-bd bg-bg/45 p-4 text-sm text-fg-muted">No warning/error timeline context found.</div>
            ) : (
              <div className="space-y-2">
                {turns.map((turn, i) => (
                  <TurnRow key={`${turn.type}-${i}`} turn={turn} redact={redact} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function TurnRow({ turn, redact }: { turn: LiveTranscriptTurn; redact: boolean }) {
  return (
    <div className={clsx(
      "rounded-lg border p-3",
      turn.severity === "error" ? "border-err/40 bg-err/10" : turn.severity === "warning" ? "border-warn/40 bg-warn/10" : "border-bd bg-bg/45"
    )}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-fg-muted">{turn.label}</span>
        <span className="rounded bg-bg-elev px-1.5 py-0.5 text-[10px] text-fg-dim">{turn.type}</span>
        {turn.at ? <span className="mono text-[10px] text-fg-dim">{new Date(turn.at).toLocaleTimeString()}</span> : null}
      </div>
      <pre className="mono max-h-40 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-fg-muted">
        {displayText(turn.preview, redact)}
      </pre>
    </div>
  );
}

function UsageTimeline({ session }: { session: LiveSession }) {
  const maxOutput = Math.max(...session.usageSegments.map((segment) => segment.cumulativeOutput), 1);
  return (
    <div className="space-y-2">
      {session.usageSegments.map((segment, index) => {
        const width = Math.max(4, Math.round((segment.cumulativeOutput / maxOutput) * 100));
        return (
          <div key={`${segment.atMs}-${index}`} className="rounded border border-bd-subtle bg-bg/40 p-2">
            <div className="mb-1 flex items-center justify-between gap-3 text-[10px] text-fg-muted">
              <span className="mono tabular-nums">{new Date(segment.atMs).toLocaleTimeString()}</span>
              <span className="mono tabular-nums">{fmt(segment.cumulativeOutput)} out · {segment.outTokPerSec.toFixed(1)} tok/s</span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-bg-elev">
              <div className="h-full rounded bg-accent-soft" style={{ width: `${width}%` }} />
            </div>
            <div className="mt-1 text-[10px] text-fg-dim">
              +{fmt(segment.deltaInput)} input · +{fmt(segment.deltaOutput)} output
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SelectPill({ icon: Icon, value, onChange, options }: { icon: any; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <label className="inline-flex items-center gap-2 rounded-md border border-bd bg-bg-elev px-2 py-1.5 text-xs text-fg-muted">
      <Icon className="size-3.5" />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bg-transparent text-xs text-fg outline-none"
      >
        {options.map(([optionValue, label]) => <option key={optionValue} value={optionValue}>{label}</option>)}
      </select>
    </label>
  );
}

function MetricCard({ label, value }: { label: string; value: string; source?: MetricSource }) {
  return (
    <div className="rounded-lg border border-bd bg-bg/45 p-3">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-muted">{label}</div>
      <div className="mono truncate text-base font-medium tabular-nums text-fg">{value}</div>
    </div>
  );
}

function SourceCell({ label, source }: { label: string; source: MetricSource }) {
  return (
    <div className="rounded bg-bg-elev/50 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-fg-dim">{label}</div>
      <SourceChip label={source} source={source} />
    </div>
  );
}

function SourceChip({ label, source }: { label: string; source: MetricSource }) {
  return (
    <span className={clsx(
      "inline-flex items-center rounded px-1.5 py-0.5 text-[10px]",
      source === "measured" && "bg-ok/10 text-ok",
      source === "inferred" && "bg-accent/10 text-accent-soft",
      source === "missing" && "bg-warn/10 text-warn",
      source === "malformed" && "bg-err/10 text-err"
    )}>
      {label}
    </span>
  );
}

function QualityBadge({ value }: { value: number }) {
  return (
    <span className={clsx(
      "inline-flex w-fit items-center gap-1 rounded px-2 py-1 text-[11px] mono",
      value >= 80 ? "bg-ok/10 text-ok" : value >= 55 ? "bg-warn/10 text-warn" : "bg-err/10 text-err"
    )}>
      <Gauge className="size-3" /> {Math.round(value)}%
    </span>
  );
}

function StatusPill({ session }: { session: LiveSession }) {
  const stale = session.staleMs > staleThresholdMs();
  if (session.isError || session.toolErrors > 0 || session.hookErrors > 0) {
    return <span className="w-fit rounded bg-err/10 px-2 py-1 text-[10px] mono text-err">error</span>;
  }
  if (stale) return <span className="w-fit rounded bg-warn/10 px-2 py-1 text-[10px] mono text-warn">stale</span>;
  return <span className="w-fit rounded bg-ok/10 px-2 py-1 text-[10px] mono text-ok">ok</span>;
}

function MetricGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-bd-subtle bg-bg-subtle/30 p-3 space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-fg-dim">{label}</div>
      {children}
    </div>
  );
}

function Stat({ label, value, icon: Icon, tone }: { label: string; value: string; icon: any; tone?: "err" | "warn" | "ok" }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-fg-muted">
        <Icon className="size-3" /> {label}
      </div>
      <div className={clsx("mono text-base font-semibold tabular-nums", tone === "err" && "text-err", tone === "warn" && "text-warn", tone === "ok" && "text-ok")}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value, icon: Icon, tone }: { label: string; value: string; icon: any; tone?: "err" | "warn" }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-fg-muted">
        <Icon className="size-3" /> {label}
      </div>
      <div className={clsx("mono text-sm font-semibold tabular-nums", tone === "err" && "text-err", tone === "warn" && "text-warn")}>{value}</div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="mx-auto max-w-7xl p-8">
      <header className="mb-6">
        <div className="mb-2 h-8 w-64 animate-pulse rounded bg-bd-subtle" />
        <div className="h-4 w-96 animate-pulse rounded bg-bd-subtle" />
      </header>
      <section className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-bd-subtle bg-bg-subtle/30 p-3 space-y-2">
            <div className="h-3 w-20 animate-pulse rounded bg-bd-subtle" />
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="flex items-center justify-between gap-2">
                <div className="h-3 w-24 animate-pulse rounded bg-bd-subtle" />
                <div className="h-4 w-12 animate-pulse rounded bg-bd-subtle" />
              </div>
            ))}
          </div>
        ))}
      </section>
      <LoadingSkeletonRows />
    </div>
  );
}

function LoadingSkeletonRows() {
  return (
    <div className="overflow-hidden rounded-lg border border-bd bg-bg-subtle">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-bd-subtle p-4 last:border-b-0">
          <div className="h-4 w-4 animate-pulse rounded bg-bd-subtle" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 animate-pulse rounded bg-bd-subtle" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-bd-subtle" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyCard({ warnings }: { warnings: string[] }) {
  return (
    <div className="mx-auto max-w-7xl p-8">
      <div className="card flex flex-col items-center p-8 text-center">
        <Inbox className="mb-4 size-10 text-fg-muted" />
        <h2 className="mb-2 text-lg font-medium">No live sessions found yet</h2>
        <p className="max-w-md text-sm text-fg-muted">
          Sessions will appear here as <code className="mono text-xs">~/.ncode/projects/</code> accumulates{" "}
          <code className="mono text-xs">.jsonl</code> traces.
        </p>
        {warnings.length > 0 && (
          <div className="mt-4 rounded border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">{warnings.join(" · ")}</div>
        )}
      </div>
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-7xl p-8">
      <div className="card flex flex-col items-center border-err/30 p-8 text-center">
        <AlertCircle className="mb-4 size-10 text-err" />
        <h2 className="mb-2 text-lg font-medium">Could not load live sessions</h2>
        <p className="mb-4 max-w-lg break-words text-sm text-fg-muted">{redactSensitiveText(message)}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 rounded border border-bd bg-bg-elev px-3 py-1.5 text-sm hover:bg-bg-subtle"
        >
          <RefreshCw className="size-4" /> Retry now
        </button>
      </div>
    </div>
  );
}

function displayText(value: unknown, redact: boolean): string {
  return redact ? redactSensitiveText(value) : String(value ?? "");
}

function shortId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}...${id.slice(-5)}`;
}

function needsAttention(session: LiveSession): boolean {
  return session.isError || session.toolErrors > 0 || session.hookErrors > 0 || session.dataQuality < 70 || session.malformedLineCount > 0;
}

function staleThresholdMs(): number {
  return 1000 * 60 * 60 * 12;
}

function qualityTone(value: number): "ok" | "warn" | "err" {
  if (value >= 80) return "ok";
  if (value >= 55) return "warn";
  return "err";
}

function relativeTime(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60_000) return "now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} KB`;
  return `${n} B`;
}

function fmtMs(ms: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m${s}s`;
}
