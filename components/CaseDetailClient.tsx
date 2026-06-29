"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  ChevronRight, Hash, Wrench, Terminal, FileText, Gauge,
  CornerDownRight, Clock, User, Cpu, DollarSign, AlertTriangle, CheckCircle2, XCircle,
  Eye, FileCode,
} from "lucide-react";
import type { RunCaseRecord, RunnerResult } from "@/lib/types";

interface Props { caseId: string; runId: string; initial: RunCaseRecord | null; }

export default function CaseDetailClient({ caseId, runId, initial }: Props) {
  const [rc, setRc] = useState<RunCaseRecord | null>(initial);
  const [openTools, setOpenTools] = useState(true);
  const [openTranscript, setOpenTranscript] = useState(true);
  const [openPreview, setOpenPreview] = useState(true);
  const [previewContent, setPreviewContent] = useState<{ path: string; content: string; kind: "svg" | "html" } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const lastEnd = useRef(initial?.ended_at ?? 0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const terminal = (status?: string) => !!status && ["passed", "failed", "error", "skipped"].includes(status);

    async function poll() {
      try {
        const res = await fetch(`/api/runs/${runId}/case/${caseId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.case) {
          setRc(data.case);
          if (data.case.ended_at) lastEnd.current = data.case.ended_at;
          if (!cancelled && !terminal(data.case.status)) timer = setTimeout(poll, 1200);
          return;
        }
      } finally {
        if (!cancelled && !rc) timer = setTimeout(poll, 2500);
      }
    }

    if (!terminal(initial?.status)) poll();
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, runId]);

  if (!rc) return <div className="p-8 text-fg-muted">Loading…</div>;

  async function loadPreview(artifactPath: string) {
    setPreviewLoading(true);
    setPreviewContent(null);
    try {
      const res = await fetch(`/api/runs/${runId}/case/${caseId}/artifact?path=${encodeURIComponent(artifactPath)}`);
      if (!res.ok) {
        setPreviewContent(null);
        return;
      }
      const data = await res.json();
      if (data.content) {
        const isSvg = artifactPath.endsWith(".svg");
        const isHtml = artifactPath.endsWith(".html") || artifactPath.endsWith(".htm");
        setPreviewContent({
          path: artifactPath,
          content: data.content,
          kind: isSvg ? "svg" : isHtml ? "html" : "svg",
        });
      }
    } catch {
      // Artifact not available yet
    } finally {
      setPreviewLoading(false);
    }
  }

  const runner = rc.runner_result;
  const grader = rc.grader_result;

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/runs/${runId}`} className="text-xs text-fg-muted hover:text-fg">← Back to run</Link>
        <h1 className="text-xl font-semibold mt-1">{rc.case_name}</h1>
        <div className="text-xs text-fg-dim mono mt-1">{rc.case_id} · {rc.category}</div>
      </div>

      {runner && <RunSummary runner={runner} />}

      {openTools && runner && (
        <Section title="Tool calls" icon={Wrench} count={runner.toolCalls.length} open={openTools} onToggle={() => setOpenTools(!openTools)}>
          <div className="divide-y divide-bd-subtle">
            {runner.toolCalls.length === 0 && <div className="px-4 py-6 text-center text-fg-muted text-sm">No tool calls recorded.</div>}
            {runner.toolCalls.map((tc, i) => (
              <ToolCallItem key={tc.id || i} tc={tc} idx={i} />
            ))}
          </div>
        </Section>
      )}

      {openTranscript && runner && (
        <Section title="Transcript" icon={Terminal} count={runner.transcript.length} open={openTranscript} onToggle={() => setOpenTranscript(!openTranscript)}>
          <Transcript runner={runner} />
        </Section>
      )}

      {rc.case_def?.visual?.expected_artifacts?.length && (
        <Section title="Visual preview" icon={Eye} count={rc.case_def.visual.expected_artifacts.length} open={openPreview} onToggle={() => setOpenPreview(!openPreview)}>
          <div className="px-4 py-3 space-y-3">
            <div className="flex flex-wrap gap-2">
              {rc.case_def.visual.expected_artifacts.map((art) => (
                <button
                  key={art}
                  onClick={() => loadPreview(art)}
                  className={clsx(
                    "text-xs mono px-2.5 py-1.5 rounded border transition-colors",
                    previewContent?.path === art
                      ? "border-accent-soft text-accent-soft bg-accent-soft/10"
                      : "border-bd-subtle text-fg-muted hover:text-fg hover:border-fg-dim"
                  )}
                >
                  <FileCode className="size-3 inline mr-1" />
                  {art}
                </button>
              ))}
            </div>
            {previewLoading && <div className="text-xs text-fg-muted">Loading artifact…</div>}
            {previewContent && previewContent.kind === "svg" && (
              <div className="rounded-lg overflow-hidden bg-white p-4 ring-1 ring-white/10">
                <div dangerouslySetInnerHTML={{ __html: previewContent.content }} />
              </div>
            )}
            {previewContent && previewContent.kind === "html" && (
              <iframe
                sandbox=""
                srcDoc={previewContent.content}
                className="w-full rounded-lg ring-1 ring-white/10"
                style={{ minHeight: "400px", background: "#fff" }}
                title="Preview"
              />
            )}
            {!previewContent && !previewLoading && (
              <div className="text-xs text-fg-muted">
                Click an artifact filename to render it inline. Artifacts are read from the run workdir after the case has been executed or the oracle solve script has been run.
              </div>
            )}
          </div>
        </Section>
      )}

      {grader && grader.results.length > 0 && (
        <Section title="Grader results" icon={CheckCircle2} count={grader.results.length} open={true} onToggle={() => {}}>
          <div className="divide-y divide-bd-subtle">
            {grader.results.map((g, i) => (
              <div key={i} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {g.passed ? <CheckCircle2 className="size-4 text-ok" /> : <XCircle className="size-4 text-err" />}
                    <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-bg-elev">{g.spec.type}</span>
                    <span className="text-xs text-fg-muted">{g.detail}</span>
                  </div>
                  <span className="text-[10px] text-fg-dim mono">{g.durationMs}ms</span>
                </div>
                {g.output && (
                  <details className="mt-2 group">
                    <summary className="text-[11px] text-fg-muted cursor-pointer hover:text-fg">View output</summary>
                    <pre className="mt-2 text-[11px] mono text-fg-muted bg-bg p-3 rounded border border-bd-subtle overflow-x-auto max-h-64 overflow-y-auto">{g.output.slice(0, 4000)}</pre>
                  </details>
                )}
              </div>
            ))}
          </div>
          <div className="px-4 py-3 border-t border-bd-subtle bg-bg-subtle/50">
            <div className="flex items-center justify-between text-sm">
              <span className="text-fg-muted">Pass ratio</span>
              <span className={clsx("font-semibold mono", grader.passed ? "text-ok" : "text-err")}>
                {(grader.passRatio * 100).toFixed(0)}% {grader.passed ? "— PASS" : "— FAIL"}
              </span>
            </div>
          </div>
        </Section>
      )}

      {rc.error_msg && (
        <div className="card p-4 border-err/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-4 text-err shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-medium text-err">Error</div>
              <pre className="mt-2 text-[11px] mono text-fg-muted whitespace-pre-wrap">{rc.error_msg}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RunSummary({ runner }: { runner: RunnerResult }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
      <Stat label="Turns" value={String(runner.numTurns)} icon={Hash} />
      <Stat label="Duration" value={runner.durationMs < 1000 ? `${runner.durationMs}ms` : `${(runner.durationMs / 1000).toFixed(1)}s`} icon={Clock} />
      <Stat label="tok/s" value={runner.durationMs > 0 ? (runner.usage.outputTokens / (runner.durationMs / 1000)).toFixed(1) : "0"} icon={Gauge} />
      <Stat label="Tokens in" value={runner.usage.inputTokens.toLocaleString()} icon={Cpu} />
      <Stat label="Tokens out" value={runner.usage.outputTokens.toLocaleString()} icon={Cpu} />
      <Stat label="Cost" value={`$${runner.usage.costUsd.toFixed(4)}`} icon={DollarSign} />
    </div>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <div className="card p-3">
      <div className="flex items-center gap-1 text-[10px] text-fg-muted uppercase tracking-wider"><Icon className="size-3" /> {label}</div>
      <div className="text-sm font-medium mono mt-1">{value}</div>
    </div>
  );
}

function Section({ title, icon: Icon, count, open, onToggle, children }: { title: string; icon: any; count?: number; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-bg-elev transition-colors">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-fg-muted" />
          <span className="text-sm font-medium">{title}</span>
          {typeof count === "number" && <span className="text-[10px] text-fg-dim mono px-1.5 py-0.5 rounded bg-bg-elev">{count}</span>}
        </div>
        <ChevronRight className={clsx("size-4 text-fg-dim", open && "rotate-90")} />
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

function ToolCallItem({ tc, idx }: { tc: RunnerResult["toolCalls"][number]; idx: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-4 py-2.5">
      <button onClick={() => setOpen(!open)} className="w-full flex items-start gap-2 text-left">
        <span className="text-[10px] text-fg-dim mono mt-0.5">{String(idx + 1).padStart(3, "0")}</span>
        <Wrench className="size-3.5 text-accent-soft mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-medium">{tc.name}</span>
            {tc.isError && <span className="text-[10px] text-err px-1 rounded bg-err/10">error</span>}
          </div>
          <div className="text-[11px] text-fg-muted mono mt-0.5 truncate">
            {tc.output ? tc.output.slice(0, 120) : (tc.input ? JSON.stringify(tc.input).slice(0, 120) : "")}
          </div>
        </div>
        <ChevronRight className={clsx("size-3.5 text-fg-dim mt-0.5", open && "rotate-90")} />
      </button>
      {open && (
        <div className="mt-2 space-y-2 pl-6">
          {tc.input !== undefined && (
            <div>
              <div className="text-[10px] uppercase text-fg-dim mb-1">Input</div>
              <pre className="text-[11px] mono text-fg-muted bg-bg p-2 rounded border border-bd-subtle overflow-x-auto">{JSON.stringify(tc.input, null, 2)}</pre>
            </div>
          )}
          {tc.output && (
            <div>
              <div className="text-[10px] uppercase text-fg-dim mb-1">Output</div>
              <pre className="text-[11px] mono text-fg-muted bg-bg p-2 rounded border border-bd-subtle overflow-x-auto max-h-80 overflow-y-auto">{tc.output.slice(0, 8000)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Transcript({ runner }: { runner: RunnerResult }) {
  return (
    <div className="font-mono text-[12px]">
      {runner.transcript.map((m, i) => (
        <div key={i} className="border-b border-bd-subtle last:border-0">
          <div className="px-4 py-1.5 flex items-center gap-2 bg-bg-subtle/40">
            {m.role === "assistant" ? <User className="size-3 text-accent-soft" /> : <CornerDownRight className="size-3 text-fg-dim" />}
            <span className="text-[10px] uppercase tracking-wider text-fg-dim">{m.role}</span>
          </div>
          {m.content.map((b, j) => {
            if (b.type === "text") {
              return <pre key={j} className="px-4 py-2 text-fg whitespace-pre-wrap">{b.text}</pre>;
            }
            if (b.type === "tool_use") {
              return (
                <div key={j} className="px-4 py-2 flex items-start gap-2">
                  <Wrench className="size-3 text-accent-soft mt-0.5" />
                  <span className="text-accent-soft">{b.name}</span>
                  <span className="text-fg-dim">{typeof b.input === "string" ? b.input : JSON.stringify(b.input)}</span>
                </div>
              );
            }
            if (b.type === "tool_result") {
              return (
                <pre key={j} className="px-4 py-2 text-fg-muted whitespace-pre-wrap border-l-2 border-bd-subtle ml-2">{b.content.slice(0, 4000)}</pre>
              );
            }
            return null;
          })}
        </div>
      ))}
    </div>
  );
}
