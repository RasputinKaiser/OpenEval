"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import StatusBadge from "./StatusBadge";
import TelemetryStrip from "./TelemetryStrip";
import {
  ChevronRight, Wrench, Clock, Hash, Cpu, DollarSign, Loader2, CircleDot, Gauge, AlertCircle, PlayCircle,
} from "lucide-react";
import type { RunCaseRecord, GraderResult, TranscriptEntry } from "@/lib/types";

interface Props { runId: string; initialCases: RunCaseRecord[]; running: boolean; model?: string; }

export default function RunDetailClient({ runId, initialCases, running, model }: Props) {
  const [cases, setCases] = useState<RunCaseRecord[]>(initialCases);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(initialCases.length ? 0 : null);
  const [live, setLive] = useState(running);
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
            <span className="text-ok">● {counts.passed}</span>
            <span className="text-err">● {counts.failed}</span>
            <span className="text-warn">! {counts.error}</span>
            {counts.running > 0 && <span className="text-accent-soft">● {counts.running}</span>}
            {counts.pending > 0 && <span className="text-fg-dim">● {counts.pending}</span>}
          </div>

          <div className="max-h-[calc(100vh-280px)] overflow-y-auto divide-y divide-bd-subtle">
            {cases.map((c, i) => {
              const sel = selectedIdx === i;
              const runner = c.runner_result;
              const rerunHref = `/runs/new?caseIds=${encodeURIComponent(c.case_id)}${model ? `&model=${encodeURIComponent(model)}` : ""}`;
              const tokPerSec = runner && runner.durationMs > 0
                ? (runner.usage.outputTokens / (runner.durationMs / 1000)).toFixed(1)
                : "—";
              const cost = runner ? `$${runner.usage.costUsd.toFixed(4)}` : "—";
              return (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedIdx(i)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelectedIdx(i); }}
                  className={clsx(
                    "group w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors cursor-pointer",
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
                  <Link
                    href={rerunHref}
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0 inline-flex items-center gap-1 text-[10px] text-accent-soft opacity-0 group-hover:opacity-100 transition-opacity hover:underline"
                  >
                    <PlayCircle className="size-3.5" /> Re-run
                  </Link>
                  {runner && (
                    <div className="hidden md:flex flex-col items-end text-[10px] mono text-fg-dim gap-0.5 mr-1">
                      <span>{tokPerSec} tok/s</span>
                      <span>{cost}</span>
                    </div>
                  )}
                  <StatusBadge status={c.status} size="xs" />
                </div>
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
            <CaseSidePanel key={cases[selectedIdx].id} rc={cases[selectedIdx]} runId={runId} />
          )}
        </section>
      </div>
    </div>
  );
}

function CaseSidePanel({ rc, runId }: { rc: RunCaseRecord; runId: string }) {
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

      {(rc.status === "error" || rc.error_msg) && (
        <div className="card p-4 border border-warn/30">
          <div className="flex items-start gap-3">
            <AlertCircle className="size-4 text-warn shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-warn">Error</div>
              <pre className="mt-2 text-xs mono text-warn whitespace-pre-wrap break-words">{rc.error_msg || "An error occurred while running this case."}</pre>
            </div>
          </div>
        </div>
      )}

      {runner && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <Mini label="Turns" value={String(runner.numTurns)} icon={Hash} />
          <Mini label="Duration" value={runner.durationMs < 1000 ? `${runner.durationMs}ms` : `${(runner.durationMs / 1000).toFixed(1)}s`} icon={Clock} />
          <Mini label="tok/s" value={runner.durationMs > 0 ? (runner.usage.outputTokens / (runner.durationMs / 1000)).toFixed(1) : "0"} icon={Gauge} />
          <Mini label="Cost" value={`$${runner.usage.costUsd.toFixed(4)}`} icon={DollarSign} />
          <Mini label="Tokens ↑" value={runner.usage.inputTokens.toLocaleString()} icon={Cpu} />
          <Mini label="Tokens" value={runner.usage.outputTokens.toLocaleString()} icon={Cpu} />
          <Mini label="Exit" value={String(runner.exitCode)} icon={Wrench} />
        </div>
      )}

      {grader && grader.results.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-bd-subtle bg-bg-subtle/50 flex items-center justify-between">
            <span className="text-xs font-medium">Graders</span>
            <span className={clsx("text-xs mono font-semibold", grader.passed ? "text-ok" : "text-err")}>
              {(grader.passRatio * 100).toFixed(0)}%
            </span>
          </div>
          <div className="divide-y divide-bd-subtle">
            {grader.results.map((g, i) => (
              <GraderRow key={i} g={g} />
            ))}
          </div>
        </div>
      )}

      {runner && runner.transcript.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-bd-subtle bg-bg-subtle/50 text-xs font-medium">Transcript ({runner.transcript.length})</div>
          <Transcript transcript={runner.transcript} />
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
                <summary className="px-4 py-2 cursor-pointer hover:bg-bg-elev flex items-center gap-2 list-none">
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

function GraderRow({ g }: { g: GraderResult }) {
  const summary = g.detail.length > 120 ? `${g.detail.slice(0, 120)}…` : g.detail;
  const expected = g.spec.type === "file_eq" ? g.spec.expected : g.spec.type === "file_contains" ? g.spec.pattern : undefined;
  const actual = g.output ?? "";
  const showDiff = (g.spec.type === "file_eq" || g.spec.type === "file_contains") && !g.passed && actual;

  return (
    <details className="group">
      <summary className="px-4 py-2.5 cursor-pointer hover:bg-bg-elev flex items-start gap-2 list-none">
        <ChevronRight className="size-3.5 text-fg-dim mt-0.5 group-open:rotate-90 transition-transform" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-bg-elev">{g.spec.type}</span>
            <span className={clsx("text-[10px] px-1.5 py-0.5 rounded-full border", g.passed ? "text-ok border-ok/30 bg-ok/10" : "text-err border-err/30 bg-err/10")}>
              {g.passed ? "passed" : "failed"}
            </span>
            <span className="text-[10px] text-fg-dim mono">{g.durationMs}ms</span>
          </div>
          <div className={clsx("text-[11px] mt-1 break-words", g.passed ? "text-fg-muted" : "text-fg")}>{summary}</div>
        </div>
      </summary>
      <div className="px-4 py-3 space-y-3 bg-bg-subtle/30 border-t border-bd-subtle">
        <div>
          <div className="text-[10px] uppercase text-fg-dim mb-1">Detail</div>
          <pre className="text-[11px] mono text-fg-muted whitespace-pre-wrap break-words">{g.detail}</pre>
        </div>
        {showDiff ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {expected !== undefined && (
              <div>
                <div className="text-[10px] uppercase text-fg-dim mb-1">Expected</div>
                <pre className="text-[10px] mono text-fg bg-bg p-2 rounded border border-bd-subtle overflow-auto max-h-96 whitespace-pre-wrap break-words">{String(expected)}</pre>
              </div>
            )}
            <div className={expected === undefined ? "md:col-span-2" : ""}>
              <div className="text-[10px] uppercase text-fg-dim mb-1">Actual</div>
              <pre className="text-[10px] mono text-fg bg-bg p-2 rounded border border-bd-subtle overflow-auto max-h-96 whitespace-pre-wrap break-words">{actual}</pre>
            </div>
          </div>
        ) : g.output ? (
          <div>
            <div className="text-[10px] uppercase text-fg-dim mb-1">Output</div>
            <pre className="text-[11px] mono text-fg-dim bg-bg p-2 rounded border border-bd-subtle overflow-auto max-h-96 whitespace-pre-wrap break-words">{g.output}</pre>
          </div>
        ) : null}
      </div>
    </details>
  );
}

const MAX_ENTRY_LEN = 8000;

function Transcript({ transcript }: { transcript: TranscriptEntry[] }) {
  return (
    <div className="font-mono text-[12px]">
      {transcript.map((entry, i) => (
        <TranscriptEntryRow key={entry.uuid || i} entry={entry} />
      ))}
    </div>
  );
}

function TranscriptEntryRow({ entry }: { entry: TranscriptEntry }) {
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
          <pre className="mt-1 pl-5 text-[11px] mono text-fg-muted whitespace-pre-wrap border-l-2 border-bd-subtle break-words max-h-96 overflow-auto">{text}</pre>
        </details>
      );
    }
    return null;
  });

  return (
    <div className="border-b border-bd-subtle last:border-0">
      <div className="px-4 py-1.5 flex items-center gap-2 bg-bg-subtle/40">
        <span className="text-[10px] uppercase tracking-wider text-fg-dim">{entry.role}</span>
        {entry.atMs !== undefined && <span className="text-[10px] text-fg-dim mono">@ {entry.atMs}ms</span>}
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
