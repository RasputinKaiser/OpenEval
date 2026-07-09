"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Boxes, RefreshCw, HelpCircle, AlertTriangle, Activity, Search, DatabaseZap } from "lucide-react";
import PageHeader from "./PageHeader";
import { fmtNum, fmtNumFull, fmtUsd, fmtUsdFull, fmtRel } from "@/lib/format";
import type { AllSourcesResult } from "@/lib/collection/aggregate";
import type { RollupReport } from "@/lib/collection/rollup";
import type { FtsHit } from "@/lib/live-cache";

function StatusPill({ status }: { status: "present" | "empty" | "absent" }) {
  const tone = status === "present" ? "bg-ok/15 text-ok" : status === "empty" ? "bg-warn/15 text-warn" : "bg-bg-elev text-fg-dim";
  return <span className={clsx("rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider", tone)}>{status}</span>;
}

function Stat({ label, value, sub, title }: { label: string; value: string; sub?: string; title?: string }) {
  return (
    <div className="card p-3" title={title}>
      <div className="text-[10px] uppercase tracking-wider text-fg-muted">{label}</div>
      <div className="text-lg mono font-semibold tabular-nums mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-fg-dim mono">{sub}</div>}
    </div>
  );
}

export default function CollectionClient({ initialData, error, initialQuery, rollup }: { initialData: AllSourcesResult; error?: string; initialQuery?: string; rollup?: RollupReport }) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(error);
  const [q, setQ] = useState(initialQuery ?? "");
  const [hits, setHits] = useState<FtsHit[] | null>(null);
  const ranInitial = useRef(false);

  // A ?q= handoff (e.g. from the dashboard search box) runs immediately.
  useEffect(() => {
    if (initialQuery && !ranInitial.current) {
      ranInitial.current = true;
      void runSearch(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);
  const [searching, setSearching] = useState(false);
  const [indexInfo, setIndexInfo] = useState<{ indexedFiles: number; totalFiles: number } | null>(null);
  const [indexing, setIndexing] = useState(false);

  async function runSearch(query: string) {
    if (!query.trim()) { setHits(null); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/collection/search?q=${encodeURIComponent(query)}&limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setHits(d.hits);
      setIndexInfo(d.index);
      setErr(undefined);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }

  async function buildIndex() {
    setIndexing(true);
    try {
      let remaining = 1;
      while (remaining > 0) {
        const res = await fetch("/api/collection/search/index", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ max: 25 }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        remaining = d.remaining;
        setIndexInfo({ indexedFiles: d.total - d.remaining, totalFiles: d.total });
      }
      if (q.trim()) await runSearch(q);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setIndexing(false);
    }
  }

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/collection?limit=80");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setErr(undefined);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <PageHeader
        icon={Boxes}
        title="Collection"
        subtitle="Live & archived transcripts discovered across every agent harness on this machine. Archived sessions outlive their pruned files."
        actions={
          <>
            <Link
              href="/collection/timeline"
              className="flex items-center gap-1.5 rounded-md border border-bd px-2.5 py-1.5 text-sm text-fg-muted hover:bg-bg-elev hover:text-fg transition-colors"
            >
              <Activity className="size-3.5" /> Timeline &amp; Impact
            </Link>
            <button
              onClick={refresh}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-md border border-bd px-2.5 py-1.5 text-sm text-fg-muted hover:bg-bg-elev hover:text-fg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={clsx("size-3.5", loading && "animate-spin")} /> Rescan
            </button>
          </>
        }
      />

      {err && <div className="card p-3 mb-4 text-sm text-err flex items-center gap-2"><AlertTriangle className="size-4" /> {err}</div>}

      <section className="stagger-grid grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
        <Stat label="Present sources" value={String(data.presentSources)} sub={`${data.sources.length} known`} />
        <Stat label="Files on disk" value={fmtNum(data.totalFiles)} title={fmtNumFull(data.totalFiles)} />
        <Stat
          label="Parsed sessions"
          value={fmtNum(data.totalParsedSessions)}
          title={fmtNumFull(data.totalParsedSessions)}
          sub={data.totalArchivedSessions > 0 ? `incl. ${fmtNum(data.totalArchivedSessions)} archived` : undefined}
        />
        <Stat
          label={data.anyEstimatedCost ? "Est. cost" : "Total cost"}
          value={(data.anyEstimatedCost ? "~" : "") + fmtUsd(data.totalCostUsd)}
          title={fmtUsdFull(data.totalCostUsd)}
          sub={data.anyEstimatedCost ? "from token usage" : undefined}
        />
        <Stat
          label="Tokens"
          value={fmtNum(data.totalInputTokens + data.totalOutputTokens)}
          title={fmtNumFull(data.totalInputTokens + data.totalOutputTokens)}
          sub={`↑${fmtNum(data.totalInputTokens)} ↓${fmtNum(data.totalOutputTokens)}`}
        />
        <Stat label="Tool calls" value={fmtNum(data.totalToolCalls)} title={fmtNumFull(data.totalToolCalls)} />
      </section>

      <section className="card p-3 mb-5">
        <form
          onSubmit={(e) => { e.preventDefault(); runSearch(q); }}
          className="flex items-center gap-2"
        >
          <Search className="size-4 text-fg-dim shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search every session, every harness… (e.g. auth refactor)"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-fg-dim"
          />
          <button
            type="submit"
            disabled={searching || !q.trim()}
            className="rounded-md border border-bd px-2.5 py-1 text-sm text-fg-muted hover:bg-bg-elev hover:text-fg transition-colors disabled:opacity-50"
          >
            {searching ? "Searching…" : "Search"}
          </button>
          {indexInfo && indexInfo.indexedFiles < indexInfo.totalFiles && (
            <button
              type="button"
              onClick={buildIndex}
              disabled={indexing}
              title="Reads transcripts and indexes their text for search. Incremental — only new/changed files are read."
              className="flex items-center gap-1.5 rounded-md border border-bd px-2.5 py-1 text-sm text-warn hover:bg-bg-elev transition-colors disabled:opacity-60"
            >
              <DatabaseZap className={clsx("size-3.5", indexing && "animate-pulse")} />
              {indexing ? `Indexing ${indexInfo.indexedFiles}/${indexInfo.totalFiles}…` : `Index ${indexInfo.totalFiles - indexInfo.indexedFiles} files`}
            </button>
          )}
        </form>
        {hits !== null && (
          <div className="mt-3 border-t border-bd/50 pt-2">
            {indexInfo && indexInfo.indexedFiles < indexInfo.totalFiles && !indexing && (
              <p className="text-[11px] text-warn mb-2">Only {indexInfo.indexedFiles}/{indexInfo.totalFiles} files indexed — results may be incomplete.</p>
            )}
            {hits.length === 0 && <p className="text-sm text-fg-dim py-2">No matches.</p>}
            <div className="space-y-1">
              {hits.map((h) => (
                <Link
                  key={h.file}
                  href={`/collection/session?file=${encodeURIComponent(h.file)}`}
                  className="block text-sm rounded-md px-2 py-1.5 -mx-2 hover:bg-bg-elev transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="rounded bg-accent/10 text-accent-soft px-1.5 py-0.5 text-[10px] shrink-0">{h.sourceId}</span>
                    <span className="truncate font-medium">{h.title || h.file.split("/").pop()}</span>
                    <span className="text-[11px] text-fg-dim mono shrink-0 ml-auto tabular-nums">{fmtRel(h.at)}</span>
                  </div>
                  <div className="text-[12px] text-fg-muted mono mt-0.5 line-clamp-2">{h.snippet}</div>
                  <div className="text-[10px] text-fg-dim truncate">{h.project}</div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>

      {rollup && rollup.weekly.some((w) => w.sessions > 0) && (
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-5">
          <div className="card p-4 lg:col-span-2">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-[11px] uppercase tracking-wider text-fg-muted">Usage by week{rollup.anyEstimatedCost ? " — est. cost" : ""}</h2>
              <span className="text-[10px] text-fg-dim mono">last {rollup.weekly.length} weeks</span>
            </div>
            {(() => {
              const maxCost = Math.max(...rollup.weekly.map((w) => w.costUsd), 0.01);
              const AREA = 96; // px — explicit, because %-heights die in nested flex columns
              return (
                <div className="flex items-end gap-1">
                  {rollup.weekly.map((w) => (
                    <div
                      key={w.startMs}
                      className="flex-1 flex flex-col items-center gap-1 min-w-0 group"
                      title={`${w.label}: ${w.sessions} sessions · ${(rollup.anyEstimatedCost ? "~" : "") + fmtUsd(w.costUsd)} · ${fmtNum(w.inputTokens + w.outputTokens)} tokens · ${fmtNum(w.toolCalls)} tool calls`}
                    >
                      <div
                        className="w-full rounded-sm transition-colors"
                        style={{
                          height: `${w.costUsd > 0 ? Math.max(3, Math.round((w.costUsd / maxCost) * AREA)) : 1}px`,
                          background: "color-mix(in srgb, var(--color-accent) 55%, transparent)",
                        }}
                      />
                      <span className="text-[9px] text-fg-dim mono truncate w-full text-center">{w.label}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
          <div className="card p-4">
            <h2 className="text-[11px] uppercase tracking-wider text-fg-muted mb-2">Top projects by {rollup.anyEstimatedCost ? "est. " : ""}cost</h2>
            <div className="space-y-1.5">
              {rollup.byProject.map((p) => (
                <div key={p.project} className="flex items-center gap-2 text-sm min-w-0" title={`${p.sessions} sessions · ${fmtNum(p.tokens)} tokens · last active ${fmtRel(p.lastActiveMs)}`}>
                  <span className="truncate flex-1 text-fg-muted text-[12px]">{p.project.split("/").slice(-2).join("/")}</span>
                  <span className="mono tabular-nums text-[12px] shrink-0">{(rollup.anyEstimatedCost ? "~" : "") + fmtUsd(p.costUsd)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="card overflow-hidden mb-5">
        <div className="px-3 py-2 border-b border-bd text-[11px] uppercase tracking-wider text-fg-muted">Sources</div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Harness</th>
                <th>Status</th>
                <th>Format</th>
                <th className="num">Files</th>
                <th className="num">Parsed</th>
                <th className="num">Tokens</th>
                <th className="num">Cost</th>
                <th className="num">Activity</th>
              </tr>
            </thead>
            <tbody>
              {data.sources.map((s) => (
                <tr key={s.id} className={clsx(s.status === "absent" && "opacity-45")}>
                  <td>
                    <div className="font-medium">{s.label}</div>
                    {!s.parseable && <div className="text-[10px] text-fg-dim flex items-center gap-1"><HelpCircle className="size-3" /> detect-only{s.note ? ` — ${s.note}` : ""}</div>}
                  </td>
                  <td><StatusPill status={s.status} /></td>
                  <td className="mono text-[11px] text-fg-muted">{s.format}</td>
                  <td className="num">{s.filesFound ? fmtNum(s.filesFound) : "—"}</td>
                  <td className="num" title={s.archivedSessions > 0 ? `${s.archivedSessions} archived (files pruned from disk; kept from the parse archive)` : undefined}>
                    {s.parseable ? <>{fmtNum(s.parsedSessions)}{s.archivedSessions > 0 && <span className="text-fg-dim text-[10px]"> +{fmtNum(s.archivedSessions)}a</span>}</> : <span className="text-fg-dim">n/a</span>}
                  </td>
                  <td className="num text-fg-muted" title={s.parseable && s.parsedSessions ? fmtNumFull(s.totalInputTokens + s.totalOutputTokens) : undefined}>{s.parseable && s.parsedSessions ? fmtNum(s.totalInputTokens + s.totalOutputTokens) : "—"}</td>
                  <td className="num text-fg-muted" title={s.parseable && s.totalCostUsd ? `${fmtUsdFull(s.totalCostUsd)}${s.costEstimated ? " — estimated from token usage" : ""}` : undefined}>{s.parseable && s.totalCostUsd ? (s.costEstimated ? "~" : "") + fmtUsd(s.totalCostUsd) : "—"}</td>
                  <td className="num text-fg-dim">{fmtRel(s.lastActivityMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {data.unknown.length > 0 && (
        <section className="card p-3 mb-5">
          <div className="text-[11px] uppercase tracking-wider text-fg-muted mb-2 flex items-center gap-1.5">
            <HelpCircle className="size-3.5" /> Unknown transcript-like sources ({data.unknown.length})
          </div>
          <p className="text-[11px] text-fg-dim mb-2">Found transcript-shaped JSONL from a harness we don&apos;t recognize yet. Not parsed into metrics — add a registry entry to collect them accurately.</p>
          <div className="space-y-1">
            {data.unknown.map((u) => (
              <div key={u.dir} className="flex items-center justify-between text-[12px] mono">
                <span className="text-fg-muted truncate">{u.displayDir}</span>
                <span className="text-fg-dim shrink-0 ml-3 tabular-nums">{u.fileCount} jsonl</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card overflow-hidden">
        <div className="px-3 py-2 border-b border-bd text-[11px] uppercase tracking-wider text-fg-muted">Recent sessions — all harnesses</div>
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Model</th>
                <th>Project</th>
                <th className="num">Tokens</th>
                <th className="num">Tools</th>
                <th className="num">DQ</th>
                <th className="num">When</th>
              </tr>
            </thead>
            <tbody>
              {data.sessions.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-fg-dim text-sm">No parsed sessions found.</td></tr>
              )}
              {data.sessions.map((s, i) => (
                <tr key={`${s.sourceId}-${s.sessionId}-${i}`}>
                  <td>
                    <span className="rounded bg-accent/10 text-accent-soft px-1.5 py-0.5 text-[10px]">{s.sourceLabel}</span>
                    {s.archived && <span className="ml-1 rounded bg-bg-elev text-fg-dim px-1.5 py-0.5 text-[10px]" title="File pruned from disk; kept from the parse archive">archived</span>}
                  </td>
                  <td className="mono text-[11px]">{s.model ?? <span className="text-fg-dim">unknown</span>}</td>
                  <td className="text-[11px] truncate max-w-[220px]">
                    {s.path ? (
                      <Link href={`/collection/session?file=${encodeURIComponent(s.path)}`} className="text-fg-muted hover:text-accent-soft hover:underline" title="Open transcript">
                        {s.project}
                      </Link>
                    ) : (
                      <span className="text-fg-muted">{s.project}</span>
                    )}
                  </td>
                  <td className="num text-fg-muted" title={fmtNumFull(s.inputTokens + s.outputTokens)}>{fmtNum(s.inputTokens + s.outputTokens)}</td>
                  <td className="num">{s.toolCalls}{s.toolErrors > 0 && <span className="text-err"> ({s.toolErrors}✗)</span>}</td>
                  <td className="num text-fg-dim">{Math.round(s.dataQuality)}</td>
                  <td className="num text-fg-dim">{fmtRel(s.lastEventAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {data.anyEstimatedCost && (
        <p className="text-[11px] text-fg-dim mt-3">
          ~ Costs marked with a tilde are <span className="text-fg-muted">estimated</span> from measured token usage and model list prices (session files don&apos;t record cost). Models without a known rate show no cost rather than a guess. Edit rates in <span className="mono">lib/pricing.ts</span>.
        </p>
      )}
    </div>
  );
}
