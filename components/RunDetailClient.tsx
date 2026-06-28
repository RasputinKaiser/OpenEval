"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import StatusBadge from "./StatusBadge";
import TelemetryStrip from "./TelemetryStrip";
import {
  ChevronRight, Wrench, Clock, Hash, Cpu, DollarSign, Loader2, CircleDot, Gauge,
  Eye, EyeOff,
} from "lucide-react";
import type { RunCaseRecord } from "@/lib/types";

interface Props { runId: string; initialCases: RunCaseRecord[]; running: boolean; }

export default function RunDetailClient({ runId, initialCases, running }: Props) {
  const [cases, setCases] = useState<RunCaseRecord[]>(initialCases);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(initialCases.length ? 0 : null);
  const [live, setLive] = useState(running);
  const [debug, setDebug] = useState(false);
  const lastSig = useRefSig(cases);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    let t: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/runs/${runId}`).then((r) => r.json());
        if (cancelled) return;
        if (res.cases) setCases(res.cases);
        if (res.run?.status !== "running") setLive(false);
      } finally {
        if (!cancelled && live) t = setTimeout(poll, 1500);
      }
    };
    poll();
    return () => { cancelled = true; clearTimeout(t); };
  }, [runId, live]);

  const counts = {
    passed: cases.filter((c) => c.status === "passed").length,
    failed: cases.filter((c) => c.status === "failed").length,
    error: cases.filter((c) => c.status === "error").length,
    running: cases.filter((c) => c.status === "running" || c.status === "grading").length,
    pending: cases.filter((c) => c.status === "pending").length,
  };

  return (
    <div>
      <TelemetryStrip runId={runId} />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-4">
        <section className="card overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-bd flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Hash className="size-3.5 text-fg-muted" />
            <span className="text-sm font-medium">Cases</span>
            <span className="text-[10px] text-fg-dim mono px-1.5 py-0.5 rounded bg-bg-elev">{cases.length}</span>
          </div>
          {live && <Loader2 className="size-3.5 text-accent-soft animate-spin" />}
        </div>

        <div className="px-4 py-2 border-b border-bd-subtle flex gap-3 text-[11px]">
          <span className="text-ok"> {counts.passed}</span>
          <span className="text-err"> {counts.failed}</span>
          <span className="text-err">! {counts.error}</span>
          {counts.running > 0 && <span className="text-accent-soft">◐ {counts.running}</span>}
          {counts.pending > 0 && <span className="text-fg-dim">◌ {counts.pending}</span>}
        </div>

        <div className="max-h-[calc(100vh-280px)] overflow-y-auto divide-y divide-bd-subtle">
          {cases.map((c, i) => {
            const sel = selectedIdx === i;
            const runner = c.runner_result;
            const tokPerSec = runner && runner.durationMs > 0
              ? (runner.usage.outputTokens / (runner.durationMs / 1000)).toFixed(1)
              : "—";
            const cost = runner ? `$${runner.usage.costUsd.toFixed(4)}` : "—";
            return (
              <button
                key={c.id}
                onClick={() => setSelectedIdx(i)}
                className={clsx(
                  "w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors",
                  sel ? "bg-accent/10" : "hover:bg-bg-elev"
                )}
              >
                <span className="text-[10px] text-fg-dim mono w-6 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate">{c.case_name}</div>
                  <div className="text-[10px] text-fg-dim mono mt-0.5 flex items-center gap-1.5">
                    <span className="px-1 rounded bg-bg-elev">{c.category}</span>
                    {runner && <span>· turns {runner.numTurns} · {runner.toolCalls.length} tools</span>}
                  </div>
                </div>
                {runner && (
                  <div className="hidden md:flex flex-col items-end text-[10px] mono text-fg-dim gap-0.5 mr-1">
                    <span>{tokPerSec} tok/s</span>
                    <span>{cost}</span>
                  </div>
                )}
                <StatusBadge status={c.status} size="xs" />
              </button>
            );
          })}
        </div>
      </section>

      <section>
        {selectedIdx === null || !cases[selectedIdx] ? (
          <div className="card p-12 text-center">
            <CircleDot className="size-8 text-fg-dim mx-auto mb-2" />
            <div className="text-sm text-fg-muted">Select a case to view details</div>
            <div className="text-[11px] text-fg-dim mt-1">Live transcript and grading results available after completion</div>
          </div>
        ) : (
          <CaseSidePanel key={cases[selectedIdx].id} rc={cases[selectedIdx]} runId={runId} debug={debug} setDebug={setDebug} />
        )}
      </section>
      </div>
    </div>
  );
}

function CaseSidePanel({ rc, runId, debug, setDebug }: { rc: RunCaseRecord; runId: string; debug: boolean; setDebug: (v: boolean) => void; }) {
  const runner = rc.runner_result;
  const grader = rc.grader_result;
  return (
    <div className="space-y-3">
      <div className="card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold">{rc.case_name}</div>
            <div className="text-[11px] text-fg-dim mono mt-0.5">{rc.case_id}</div>
          </div>
          <StatusBadge status={rc.status} size="md" />
        </div>
      </div>

      {runner && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <Mini label="Turns" value={String(runner.numTurns)} icon={Hash} />
          <Mini label="Duration" value={runner.durationMs < 1000 ? `${runner.durationMs}ms` : `${(runner.durationMs / 1000).toFixed(1)}s`} icon={Clock} />
          <Mini label="tok/s" value={runner.durationMs > 0 ? (runner.usage.outputTokens / (runner.durationMs / 1000)).toFixed(1) : "0"} icon={Gauge} />
          <Mini label="Cost" value={`$${runner.usage.costUsd.toFixed(4)}`} icon={DollarSign} />
          <Mini label="Tokens ↑" value={runner.usage.inputTokens.toLocaleString()} icon={Cpu} />
          <Mini label="Tokens ↓" value={runner.usage.outputTokens.toLocaleString()} icon={Cpu} />
          <Mini label="Exit" value={String(runner.exitCode)} icon={Wrench} />
        </div>
      )}

      {grader && grader.results.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-bd-subtle bg-bg-subtle/50 flex items-center justify-between">
            <span className="text-xs font-medium">Graders</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDebug(!debug)}
                className={clsx(
                  "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] mono border border-bd-subtle transition-colors",
                  debug ? "bg-accent/10 text-accent-soft" : "text-fg-muted hover:text-fg"
                )}
                aria-pressed={debug}
              >
                {debug ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                Debug
              </button>
              <span className={clsx("text-xs mono font-semibold", grader.passed ? "text-ok" : "text-err")}>
                {(grader.passRatio * 100).toFixed(0)}%
              </span>
            </div>
          </div>
          <div className="divide-y divide-bd-subtle">
            {grader.results.map((g, i) => (
              <div key={i} className="px-4 py-2.5">
                <div className="flex items-start gap-2">
                  <span className={clsx("text-base leading-none", g.passed ? "text-ok" : "text-err")}>{g.passed ? "" : ""}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-bg-elev">{g.spec.type}</span>
                      <span className="text-[10px] text-fg-dim mono">{g.durationMs}ms</span>
                    </div>
                    <div className="text-[11px] text-fg-muted mt-1 break-words">{g.detail}</div>
                    {debug && g.output && <pre className="mt-1.5 text-[10px] mono text-fg-dim bg-bg p-2 rounded border border-bd-subtle overflow-x-auto max-h-80 overflow-y-auto">{g.output}</pre>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {runner && runner.finalText && (
        <div className="card p-4">
          <div className="text-[10px] uppercase tracking-wider text-fg-muted mb-2">Final answer</div>
          <pre className="text-[12px] mono text-fg whitespace-pre-wrap max-h-64 overflow-y-auto">{runner.finalText}</pre>
        </div>
      )}

      {runner && runner.toolCalls.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-bd-subtle bg-bg-subtle/50 text-xs font-medium">Tool calls ({runner.toolCalls.length})</div>
          <div className="divide-y divide-bd-subtle max-h-80 overflow-y-auto">
            {runner.toolCalls.map((tc, i) => (
              <details key={tc.id || i} className="group">
                <summary className="px-4 py-2 cursor-pointer hover:bg-bg-elev flex items-center gap-2">
                  <ChevronRight className="size-3 text-fg-dim group-open:rotate-90 transition-transform" />
                  <span className="text-[10px] text-fg-dim mono w-6">{String(i + 1).padStart(2, "0")}</span>
                  <span className="text-xs font-mono">{tc.name}</span>
                  {tc.isError && <span className="text-[10px] text-err px-1 rounded bg-err/10">err</span>}
                </summary>
                <div className="px-4 py-2 space-y-2 bg-bg-subtle/30">
                  {tc.input !== undefined && <pre className="text-[10px] mono text-fg-muted overflow-x-auto">{JSON.stringify(tc.input, null, 2).slice(0, 2000)}</pre>}
                  {tc.output && <pre className="text-[10px] mono text-fg-dim overflow-x-auto">{tc.output.slice(0, 2000)}</pre>}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      <div className="text-center">
        <Link href={`/runs/${runId}/case/${rc.case_id}`} className="text-xs text-accent-soft hover:underline">Open full transcript →</Link>
      </div>
    </div>
  );
}

function Mini({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <div className="card p-3">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-fg-muted mb-1">
        <Icon className="size-3" /> {label}
      </div>
      <div className="text-sm font-medium mono">{value}</div>
    </div>
  );
}

function useRefSig(_cases: RunCaseRecord[]) {
  // placeholder for future diff-based streaming
  return null;
}
