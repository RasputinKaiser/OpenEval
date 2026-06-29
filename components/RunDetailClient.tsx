"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import StatusBadge from "./StatusBadge";
import HarnessBadge from "./HarnessBadge";
import TelemetryStrip from "./TelemetryStrip";
import {
  ChevronRight, Wrench, Clock, Hash, Cpu, DollarSign, Loader2, CircleDot, Gauge, AlertCircle, PlayCircle,
  Eye, FileCode, Palette, Sparkles, ShieldCheck, ShieldAlert, CheckCircle2, XCircle, Boxes, FlaskConical,
  SearchCheck, BadgeCheck, Scale, Fingerprint, Search,
} from "lucide-react";
import type { EvidenceTier, GraderResult, GraderSpec, RunCaseRecord, TranscriptEntry } from "@/lib/types";
import { useFocusOnSlash } from "@/lib/use-focus-slash";

interface Props { runId: string; runName?: string; initialCases: RunCaseRecord[]; running: boolean; model?: string; harness?: string; harnessInfo?: { id: string; bin: string | null; version: string | null }; }

export default function RunDetailClient({ runId, runName, initialCases, running, model, harness, harnessInfo }: Props) {
  const [cases, setCases] = useState<RunCaseRecord[]>(initialCases);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(initialCases.length ? 0 : null);
  const [live, setLive] = useState(running);
  const [caseSearch, setCaseSearch] = useState("");
  const [caseFilter, setCaseFilter] = useState<string>("all");
  const caseSearchRef = useRef<HTMLInputElement>(null);
  useFocusOnSlash(caseSearchRef);

  const visibleCases = useMemo(() => {
    const q = caseSearch.trim().toLowerCase();
    return cases
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => {
        if (caseFilter !== "all" && c.status !== caseFilter) return false;
        if (!q) return true;
        return c.case_name.toLowerCase().includes(q) ||
          c.case_id.toLowerCase().includes(q) ||
          c.category.toLowerCase().includes(q);
      });
  }, [cases, caseSearch, caseFilter]);

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
  const completed = counts.passed + counts.failed + counts.error;
  const passRatio = cases.length ? Math.round((counts.passed / cases.length) * 100) : 0;
  const visualCases = cases.filter((c) => c.case_def?.visual?.expected_artifacts?.length);
  const activeCase = selectedIdx === null ? null : cases[selectedIdx] ?? null;
  const confidence = summarizeRunConfidence(cases);

  return (
    <div>
      <TelemetryStrip runId={runId} />
      <section className="mb-4 overflow-hidden rounded-lg border border-bd bg-[linear-gradient(135deg,rgba(124,92,255,0.18),rgba(17,17,19,0.96)_42%,rgba(63,185,80,0.09))]">
        <div className="stagger-grid grid gap-4 p-4 xl:grid-cols-[1fr_360px] xl:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-muted">
              <span className="inline-flex items-center gap-1 rounded border border-accent-soft/30 bg-accent/15 px-2 py-1 text-accent-soft">
                <span className="icon-crossfade relative inline-flex size-3">
                <CircleDot className={clsx("absolute inset-0 size-3", live && "opacity-0")} />
                <Loader2 className={clsx("absolute inset-0 size-3 animate-spin", live ? "opacity-100" : "opacity-0")} />
              </span>
              {live ? "Running eval" : "Eval complete"}
              </span>
              {harness && <HarnessBadge harness={harness} bin={harnessInfo?.bin} version={harnessInfo?.version} />}
              <span className="mono">{runId}</span>
              {model && <span className="mono">{model}</span>}
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-normal text-fg md:text-3xl">{runName || "Run output"}</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-fg-muted">
              Watch cases resolve, inspect grader evidence, preview artifacts, and see how much proof backs the score.
            </p>
          </div>
          <div className="rounded-lg border border-bd-subtle bg-bg/55 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-fg-muted">Progress</span>
              <span className="mono text-fg">{completed}/{cases.length}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-bg-elev">
              <div className="h-full rounded-full bg-accent-soft transition-[width] duration-300" style={{ width: `${cases.length ? (completed / cases.length) * 100 : 0}%` }} />
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              <RunMetric label="Pass" value={String(counts.passed)} tone="ok" />
              <RunMetric label="Fail" value={String(counts.failed)} tone="err" />
              <RunMetric label="Live" value={String(counts.running)} tone="accent" />
              <RunMetric label="Visual" value={String(visualCases.length)} tone="visual" />
            </div>
          </div>
        </div>
      </section>

      <RunConfidencePanel confidence={confidence} />
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

          <div className="px-4 py-2 border-b border-bd-subtle flex flex-wrap items-center gap-2 text-[11px]">
            <button onClick={() => setCaseFilter("all")} className={clsx("px-1.5 py-0.5 rounded transition-colors", caseFilter === "all" ? "bg-bg-elev text-fg" : "text-fg-muted hover:text-fg")}>All</button>
            <button onClick={() => setCaseFilter("passed")} className={clsx("px-1.5 py-0.5 rounded transition-colors", caseFilter === "passed" ? "bg-ok/15 text-ok" : "text-ok hover:opacity-80")}>● {counts.passed}</button>
            <button onClick={() => setCaseFilter("failed")} className={clsx("px-1.5 py-0.5 rounded transition-colors", caseFilter === "failed" ? "bg-err/15 text-err" : "text-err hover:opacity-80")}>● {counts.failed}</button>
            <button onClick={() => setCaseFilter("error")} className={clsx("px-1.5 py-0.5 rounded transition-colors", caseFilter === "error" ? "bg-warn/15 text-warn" : "text-warn hover:opacity-80")}>! {counts.error}</button>
            {counts.running > 0 && <button onClick={() => setCaseFilter("running")} className={clsx("px-1.5 py-0.5 rounded transition-colors", caseFilter === "running" ? "bg-accent/15 text-accent-soft" : "text-accent-soft hover:opacity-80")}>● {counts.running}</button>}
            {counts.pending > 0 && <button onClick={() => setCaseFilter("pending")} className={clsx("px-1.5 py-0.5 rounded transition-colors", caseFilter === "pending" ? "bg-bg-elev text-fg" : "text-fg-dim hover:text-fg")}>● {counts.pending}</button>}
            <span className="ml-auto mono text-fg-muted">{visibleCases.length}/{cases.length} · {passRatio}%</span>
          </div>

          {cases.length > 6 && (
            <div className="px-4 py-2 border-b border-bd-subtle">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-fg-dim" />
                <input
                  ref={caseSearchRef}
                  value={caseSearch}
                  onChange={(e) => setCaseSearch(e.target.value)}
                  placeholder="Filter cases…"
                  className="w-full pl-8 pr-2 py-1.5 text-xs bg-bg border border-bd rounded-md focus:outline-none focus:border-accent placeholder:text-fg-dim"
                />
              </div>
            </div>
          )}

          <div className="max-h-[calc(100vh-280px)] overflow-y-auto divide-y divide-bd-subtle">
            {visibleCases.map(({ c, i }) => {
              const sel = selectedIdx === i;
              const runner = c.runner_result;
              const rerunHref = `/runs/new?caseIds=${encodeURIComponent(c.case_id)}${model ? `&model=${encodeURIComponent(model)}` : ""}`;
              const tokPerSec = runner && runner.durationMs > 0
                ? (runner.usage.outputTokens / (runner.durationMs / 1000)).toFixed(1)
                : "—";
              const cost = runner ? `$${runner.usage.costUsd.toFixed(4)}` : "—";
              const caseTrust = summarizeCaseTrust(c);
              return (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedIdx(i)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelectedIdx(i); }}
                  className={clsx(
                    "group w-full text-left py-2.5 flex items-center gap-3 transition-colors cursor-pointer",
                    sel ? "bg-accent/10" : "hover:bg-bg-elev"
                  )}
                >
                  <div className={clsx(
                    "ml-3 h-6 w-1 shrink-0 rounded-full",
                    c.status === "passed" ? "bg-ok" :
                    c.status === "failed" ? "bg-err" :
                    c.status === "error" ? "bg-warn" :
                    c.status === "running" || c.status === "grading" ? "bg-accent-soft animate-pulse" :
                    "bg-bd-subtle"
                  )} />
                  <span className="text-[10px] text-fg-dim mono w-6 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="truncate text-sm">{c.case_name}</div>
                      {c.case_def?.visual?.expected_artifacts?.length ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-accent-soft/10 px-1.5 py-0.5 text-[10px] text-accent-soft">
                          <Palette className="size-3" /> preview
                        </span>
                      ) : null}
                    </div>
                    <div className="text-[10px] text-fg-dim mono mt-0.5 flex items-center gap-1.5">
                      <span className="px-1 rounded bg-bg-elev">{c.category}</span>
                      {runner && <span>· turns {runner.numTurns} · {runner.toolCalls.length} tools</span>}
                    </div>
                  </div>
                  <Link
                    href={rerunHref}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Re-run ${c.case_name}`}
                    className="shrink-0 inline-flex min-h-8 items-center gap-1 rounded px-1.5 text-[10px] text-accent-soft opacity-60 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft/40 transition-opacity hover:underline"
                  >
                    <PlayCircle className="size-3.5" /> Re-run
                  </Link>
                  {runner && (
                    <div className="hidden md:flex flex-col items-end text-[10px] mono text-fg-dim gap-0.5 mr-1">
                      <span>{tokPerSec} tok/s</span>
                      <span>{cost}</span>
                    </div>
                  )}
                  <span className={clsx(
                    "hidden sm:inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] mono",
                    caseTrust.score >= 80 ? "border-ok/30 bg-ok/10 text-ok" : caseTrust.score >= 60 ? "border-warn/30 bg-warn/10 text-warn" : "border-err/30 bg-err/10 text-err"
                  )}>
                    {caseTrust.score}
                  </span>
                  <StatusBadge status={c.status} size="xs" />
                </div>
              );
            })}
            {visibleCases.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-fg-muted">
                No cases match the current filter.
              </div>
            )}
          </div>
        </section>

        <section>
          {selectedIdx === null || !activeCase ? (
            <div className="card p-12 text-center border-dashed">
              <CircleDot className="size-10 text-fg-dim mx-auto mb-3 opacity-50" />
              <div className="text-sm text-fg-muted">Select a case to view details</div>
              <div className="text-[11px] text-fg-dim mt-1">Press <kbd className="px-1 py-0.5 rounded bg-bg-elev text-fg-muted text-[10px]">/</kbd> to search cases</div>
            </div>
          ) : (
            <CaseSidePanel key={activeCase.id} rc={activeCase} runId={runId} />
          )}
        </section>
      </div>
    </div>
  );
}

function CaseSidePanel({ rc, runId }: { rc: RunCaseRecord; runId: string }) {
  const runner = rc.runner_result;
  const grader = rc.grader_result;
  const trust = summarizeCaseTrust(rc);
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
        <div className="rounded-lg border border-warn/30 bg-warn/5 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="size-4 text-warn shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-warn">Error</div>
              <pre className="mt-2 text-xs mono text-warn whitespace-pre-wrap break-words">{rc.error_msg || "An error occurred while running this case."}</pre>
            </div>
          </div>
        </div>
      )}

      <CaseTrustPanel trust={trust} rc={rc} />

      {runner && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <Mini label="Turns" value={String(runner.numTurns)} icon={Hash} />
          <Mini label="Duration" value={runner.durationMs < 1000 ? `${runner.durationMs}ms` : `${(runner.durationMs / 1000).toFixed(1)}s`} icon={Clock} />
          <Mini label="tok/s" value={runner.durationMs > 0 ? (runner.usage.outputTokens / (runner.durationMs / 1000)).toFixed(1) : "0"} icon={Gauge} />
          <Mini label="Cost" value={`$${runner.usage.costUsd.toFixed(4)}`} icon={DollarSign} />
          <Mini label="Tokens in" value={runner.usage.inputTokens.toLocaleString()} icon={Cpu} />
          <Mini label="Tokens out" value={runner.usage.outputTokens.toLocaleString()} icon={Cpu} />
        </div>
      )}

      {grader && grader.results.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-bd-subtle bg-bg-subtle/50 flex items-center justify-between">
            <span className="text-xs font-medium">Evidence groups</span>
            <span className={clsx("text-xs mono font-semibold", grader.passed ? "text-ok" : "text-err")}>
              {(grader.passRatio * 100).toFixed(0)}%
            </span>
          </div>
          <EvidenceGroupSummary results={grader.results} visualContract={!!rc.case_def.visual} />
          <div className="divide-y divide-bd-subtle">
            {grader.results.map((g, i) => (
              <GraderRow key={i} g={g} />
            ))}
          </div>
        </div>
      )}

      {rc.case_def?.visual?.expected_artifacts?.length ? (
        <ArtifactStage
          artifacts={rc.case_def.visual.expected_artifacts}
          caseId={rc.case_id}
          runId={runId}
          status={rc.status}
        />
      ) : null}

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

function RunMetric({ label, value, tone }: { label: string; value: string; tone: "ok" | "err" | "accent" | "visual" }) {
  const toneClass = {
    ok: "text-ok",
    err: "text-err",
    accent: "text-accent-soft",
    visual: "text-fg",
  }[tone];
  return (
    <div className="rounded border border-bd-subtle bg-bg-subtle/70 px-2 py-2">
      <div className={clsx("mono text-base font-semibold tabular-nums", toneClass)}>{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-fg-dim">{label}</div>
    </div>
  );
}

function RunConfidencePanel({ confidence }: { confidence: RunConfidenceSummary }) {
  return (
    <section className="card mb-4 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-bd-subtle bg-bg-subtle/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-accent-soft" />
          <div>
            <div className="text-sm font-medium">Evaluation confidence</div>
            <div className="text-[11px] text-fg-dim">
              Separates pass rate from proof coverage, adversarial coverage, and known weaknesses.
            </div>
          </div>
        </div>
        <div className={clsx(
          "rounded border px-2.5 py-1 text-xs mono",
          confidence.score >= 80 ? "border-ok/30 bg-ok/10 text-ok" : confidence.score >= 60 ? "border-warn/30 bg-warn/10 text-warn" : "border-err/30 bg-err/10 text-err"
        )}>
          {confidence.grade}
        </div>
      </div>
      <div className="grid gap-3 p-4 lg:grid-cols-[1fr_1fr_1.2fr]">
        <TrustMeter
          icon={SearchCheck}
          label="Deterministic + trace proof"
          value={`${confidence.deterministicCoverage}%`}
          help={`${confidence.provenCaseCount}/${confidence.totalCases} cases have non-LLM proof backstops`}
          tone={confidence.deterministicCoverage >= 80 ? "ok" : "warn"}
        />
        <TrustMeter
          icon={FlaskConical}
          label="Known-bad coverage"
          value={`${confidence.knownBadCoverage}%`}
          help={`${confidence.knownBadCaseCount}/${confidence.totalCases} cases include plausible bad solves to reject`}
          tone={confidence.knownBadCoverage >= 80 ? "ok" : "warn"}
        />
        <div className="rounded-lg border border-bd-subtle bg-bg/60 p-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-fg-muted">
            <ShieldAlert className="size-3" /> Weakness radar
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {confidence.topWeaknesses.length ? confidence.topWeaknesses.map((w) => (
              <span key={w.label} className="rounded border border-warn/30 bg-warn/10 px-2 py-1 text-[11px] text-warn">
                {w.count} {w.label}
              </span>
            )) : (
              <span className="rounded border border-ok/30 bg-ok/10 px-2 py-1 text-[11px] text-ok">No structural weaknesses detected</span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function TrustMeter({
  icon: Icon,
  label,
  value,
  help,
  tone,
}: {
  icon: any;
  label: string;
  value: string;
  help: string;
  tone: "ok" | "warn" | "err";
}) {
  const numPct = parseInt(value, 10);
  const hasPct = !isNaN(numPct) && value.includes("%");
  return (
    <div className="rounded-lg border border-bd-subtle bg-bg/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-fg-muted">
            <Icon className="size-3" /> {label}
          </div>
          <div className="mt-1 text-[11px] text-fg-dim">{help}</div>
        </div>
        <div className={clsx("mono text-lg font-semibold tabular-nums", tone === "ok" && "text-ok", tone === "warn" && "text-warn", tone === "err" && "text-err")}>
          {value}
        </div>
      </div>
      {hasPct && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-bg-elev">
          <div
            className={clsx("h-full rounded-full transition-[width] duration-300", tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : "bg-err")}
            style={{ width: `${Math.min(100, Math.max(0, numPct))}%` }}
          />
        </div>
      )}
    </div>
  );
}

function CaseTrustPanel({ trust, rc }: { trust: CaseTrustSummary; rc: RunCaseRecord }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-bd-subtle bg-bg-subtle/50 px-4 py-3">
        <div className="flex items-center gap-2">
          {trust.score >= 80 ? <ShieldCheck className="size-4 text-ok" /> : <ShieldAlert className="size-4 text-warn" />}
          <div>
            <div className="text-xs font-medium">Case trust contract</div>
            <div className="text-[10px] text-fg-dim mono">{trust.grade} · score {trust.score}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <TrustChip ok={trust.hasOracle} label="oracle" />
          <TrustChip ok={trust.hasKnownBad} label="known-bad" />
          <TrustChip ok={trust.hasProofBackstop} label="proof" />
          <TrustChip ok={trust.hasBudget} label="budget" />
          {rc.case_def.visual ? <TrustChip ok={trust.hasVisualContract} label="visual" /> : null}
        </div>
      </div>
      <div className="grid gap-2 p-3 sm:grid-cols-3">
        <MiniProof label="Deterministic" value={`${trust.evidence.deterministic.passed}/${trust.evidence.deterministic.total}`} icon={BadgeCheck} ok={trust.evidence.deterministic.total > 0} />
        <MiniProof label="Trace" value={`${trust.evidence.trace.passed}/${trust.evidence.trace.total}`} icon={Boxes} ok={trust.evidence.trace.total > 0} />
        <MiniProof label="Visual" value={trust.hasVisualContract ? "contracted" : "none"} icon={Eye} ok={trust.hasVisualContract} />
      </div>
      {trust.weaknesses.length ? (
        <div className="border-t border-bd-subtle px-4 py-3">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-warn">
            <ShieldAlert className="size-3" /> Weaknesses
          </div>
          <div className="flex flex-wrap gap-1.5">
            {trust.weaknesses.map((w) => (
              <span key={w} className="rounded border border-warn/30 bg-warn/10 px-2 py-1 text-[11px] text-warn">{w}</span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TrustChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={clsx(
      "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]",
      ok ? "border-ok/30 bg-ok/10 text-ok" : "border-warn/30 bg-warn/10 text-warn"
    )}>
      {ok ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
      {label}
    </span>
  );
}

function MiniProof({ label, value, icon: Icon, ok }: { label: string; value: string; icon: any; ok?: boolean }) {
  return (
    <div className={clsx("rounded border p-2", ok ? "border-ok/15 bg-ok/5" : "border-bd-subtle bg-bg/50")}>
      <div className="flex items-center justify-between gap-1 text-[10px] uppercase tracking-wider text-fg-muted">
        <div className="flex items-center gap-1">
          <Icon className="size-3" /> {label}
        </div>
        {ok !== undefined && <div className={clsx("size-1.5 rounded-full", ok ? "bg-ok" : "bg-warn")} />}
      </div>
      <div className="mt-1 text-xs mono text-fg tabular-nums">{value}</div>
    </div>
  );
}

function EvidenceGroupSummary({ results, visualContract }: { results: GraderResult[]; visualContract: boolean }) {
  const grouped = summarizeEvidence(results);
  const rawCards: Array<{ tier: EvidenceTier; label: string; icon: any; passed: number; total: number }> = [
    { tier: "deterministic", label: "Deterministic", icon: SearchCheck, passed: grouped.deterministic.passed, total: grouped.deterministic.total },
    { tier: "trace", label: "Trace", icon: Boxes, passed: grouped.trace.passed, total: grouped.trace.total },
    { tier: "visual", label: "Visual", icon: Eye, passed: visualContract ? 1 : 0, total: visualContract ? 1 : 0 },
    { tier: "llm_judge", label: "LLM judge", icon: Scale, passed: grouped.llm_judge.passed, total: grouped.llm_judge.total },
    { tier: "manual", label: "Manual", icon: Fingerprint, passed: grouped.manual.passed, total: grouped.manual.total },
  ];
  const cards = rawCards.filter((c) => c.total > 0);

  return (
    <div className="grid gap-2 border-b border-bd-subtle p-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => {
        const passed = card.total > 0 && card.passed === card.total;
        const Icon = card.icon;
        return (
          <div key={card.tier} className="rounded border border-bd-subtle bg-bg/50 p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-fg-muted">
                <Icon className="size-3" /> {card.label}
              </div>
              <span className={clsx("mono text-xs", passed ? "text-ok" : "text-warn")}>{card.passed}/{card.total}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ArtifactStage({
  artifacts,
  caseId,
  runId,
  status,
}: {
  artifacts: string[];
  caseId: string;
  runId: string;
  status: RunCaseRecord["status"];
}) {
  const [selected, setSelected] = useState(artifacts[0] ?? "");
  const [preview, setPreview] = useState<{ path: string; content: string; kind: "svg" | "html" | "text" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const main = await fetchArtifact(runId, caseId, selected);
        let content = main.content;
        const kind = artifactKind(selected, content);
        if (kind === "html" && artifacts.includes("styles.css")) {
          try {
            const css = await fetchArtifact(runId, caseId, "styles.css");
            content = inlineStyles(content, css.content);
          } catch {
            // HTML still renders without the optional stylesheet while the run is in flight.
          }
        }
        if (!cancelled) setPreview({ path: selected, content, kind });
      } catch (e) {
        if (!cancelled) {
          setPreview(null);
          setError(e instanceof Error ? e.message : "Artifact is not available yet.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [artifacts, caseId, runId, selected, status]);

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-bd-subtle bg-bg-subtle/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Eye className="size-4 text-accent-soft" />
          <div>
            <div className="text-xs font-medium">Live artifact preview</div>
            <div className="text-[10px] text-fg-dim mono">{preview?.path ?? selected}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {artifacts.map((artifact) => (
            <button
              key={artifact}
              onClick={() => setSelected(artifact)}
              className={clsx(
                "inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-[11px] mono",
                selected === artifact
                  ? "border-accent-soft bg-accent-soft/10 text-accent-soft"
                  : "border-bd-subtle bg-bg text-fg-muted hover:text-fg"
              )}
            >
              <FileCode className="size-3" />
              {artifact}
            </button>
          ))}
        </div>
      </div>
      <div className="bg-[#f6f7fb] p-3">
        {loading ? (
          <div className="flex min-h-[280px] items-center justify-center text-sm text-[#5f6673]">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Rendering artifact
          </div>
        ) : preview ? (
          preview.kind === "text" ? (
            <pre className="max-h-[420px] overflow-auto rounded-md bg-white p-4 text-[11px] text-[#20242d]">{preview.content}</pre>
          ) : (
            <iframe
              sandbox=""
              srcDoc={preview.kind === "svg" ? svgDocument(preview.content) : preview.content}
              title={`Preview of ${preview.path}`}
              className="h-[420px] w-full rounded-md bg-white ring-1 ring-white/10"
            />
          )
        ) : (
          <div className="flex min-h-[280px] flex-col items-center justify-center rounded-md border border-dashed border-[#cbd2df] bg-white px-6 text-center">
            <Sparkles className="mb-2 size-6 text-[#7c5cff]" />
            <div className="text-sm font-medium text-[#20242d]">Waiting for artifact</div>
            <div className="mt-1 max-w-sm text-xs leading-5 text-[#687182]">
              {error ?? "The preview appears automatically once the eval writes the expected file."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

async function fetchArtifact(runId: string, caseId: string, artifact: string) {
  const res = await fetch(`/api/runs/${runId}/case/${caseId}/artifact?path=${encodeURIComponent(artifact)}`);
  if (!res.ok) throw new Error("Artifact is not available yet.");
  return (await res.json()) as { path: string; content: string };
}

function artifactKind(path: string, content: string): "svg" | "html" | "text" {
  if (path.endsWith(".svg") || content.trimStart().startsWith("<svg")) return "svg";
  if (path.endsWith(".html") || path.endsWith(".htm") || content.includes("<html")) return "html";
  return "text";
}

function inlineStyles(html: string, css: string) {
  const style = `<style>${css}</style>`;
  if (html.includes("</head>")) return html.replace("</head>", `${style}</head>`);
  return `${style}${html}`;
}

function svgDocument(svg: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;min-height:100%;background:#fff;display:grid;place-items:center}svg{max-width:100%;max-height:100%;width:100%;height:auto}</style></head><body>${svg}</body></html>`;
}

type EvidenceCounts = Record<EvidenceTier, { passed: number; total: number }>;

interface CaseTrustSummary {
  score: number;
  grade: string;
  hasOracle: boolean;
  hasKnownBad: boolean;
  hasBudget: boolean;
  hasVisualContract: boolean;
  hasProofBackstop: boolean;
  evidence: EvidenceCounts;
  weaknesses: string[];
}

interface RunConfidenceSummary {
  score: number;
  grade: string;
  totalCases: number;
  provenCaseCount: number;
  knownBadCaseCount: number;
  weakCaseCount: number;
  deterministicCoverage: number;
  knownBadCoverage: number;
  oracleCoverage: number;
  visualCoverage: number;
  topWeaknesses: Array<{ label: string; count: number }>;
}

function summarizeRunConfidence(cases: RunCaseRecord[]): RunConfidenceSummary {
  const totalCases = cases.length || 1;
  const trusts = cases.map((c) => summarizeCaseTrust(c));
  const provenCaseCount = trusts.filter((t) => t.hasProofBackstop).length;
  const knownBadCaseCount = trusts.filter((t) => t.hasKnownBad).length;
  const oracleCaseCount = trusts.filter((t) => t.hasOracle).length;
  const visualCaseCount = cases.filter((c) => c.case_def.visual).length;
  const visualContractCount = trusts.filter((t) => t.hasVisualContract).length;
  const weakCaseCount = trusts.filter((t) => t.weaknesses.length > 0).length;
  const passRatio = cases.length ? cases.filter((c) => c.status === "passed").length / cases.length : 0;
  const deterministicCoverage = Math.round((provenCaseCount / totalCases) * 100);
  const knownBadCoverage = Math.round((knownBadCaseCount / totalCases) * 100);
  const oracleCoverage = Math.round((oracleCaseCount / totalCases) * 100);
  const visualCoverage = visualCaseCount ? Math.round((visualContractCount / visualCaseCount) * 100) : 100;
  const avgCaseTrust = trusts.length ? trusts.reduce((sum, t) => sum + t.score, 0) / trusts.length : 0;
  const score = clampScore(
    passRatio * 30 +
    avgCaseTrust * 0.35 +
    deterministicCoverage * 0.15 +
    knownBadCoverage * 0.1 +
    oracleCoverage * 0.05 +
    visualCoverage * 0.05
  );

  const weaknessCounts = new Map<string, number>();
  for (const trust of trusts) {
    for (const weakness of trust.weaknesses) {
      weaknessCounts.set(weakness, (weaknessCounts.get(weakness) ?? 0) + 1);
    }
  }

  return {
    score,
    grade: confidenceGrade(score),
    totalCases: cases.length,
    provenCaseCount,
    knownBadCaseCount,
    weakCaseCount,
    deterministicCoverage,
    knownBadCoverage,
    oracleCoverage,
    visualCoverage,
    topWeaknesses: Array.from(weaknessCounts, ([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}

function summarizeCaseTrust(rc: RunCaseRecord): CaseTrustSummary {
  const evidence = summarizeEvidence(rc.grader_result?.results ?? []);
  const hasOracle = !!(rc.case_def.oracle?.solve || rc.case_def.oracle?.final_text);
  const hasKnownBad = !!rc.case_def.oracle?.known_bad?.length;
  const hasBudget = !!rc.case_def.budget;
  const hasVisualContract = !rc.case_def.visual || !!rc.case_def.visual.expected_artifacts?.length;
  const hasProofBackstop = evidence.deterministic.total + evidence.trace.total > 0;
  const weaknesses: string[] = [];

  if (!hasOracle) weaknesses.push("missing oracle");
  if (!hasKnownBad) weaknesses.push("no known-bad");
  if (!hasProofBackstop) weaknesses.push("no deterministic/trace proof");
  if (evidence.llm_judge.total > 0 && evidence.deterministic.total === 0) weaknesses.push("LLM judge lacks backstop");
  if (!hasBudget) weaknesses.push("no budget");
  if (rc.case_def.visual && !hasVisualContract) weaknesses.push("visual has no artifacts");
  if (evidence.manual.total > 0) weaknesses.push("manual grader");

  const deterministicRatio = ratio(evidence.deterministic.passed + evidence.trace.passed, evidence.deterministic.total + evidence.trace.total);
  const allGraderRatio = rc.grader_result ? rc.grader_result.passRatio : statusRatio(rc.status);
  const metadataScore =
    (hasOracle ? 15 : 0) +
    (hasKnownBad ? 15 : 0) +
    (hasBudget ? 8 : 0) +
    (hasVisualContract ? 7 : 0);
  const score = clampScore(allGraderRatio * 35 + deterministicRatio * 20 + metadataScore - Math.max(0, weaknesses.length - 1) * 5);

  return {
    score,
    grade: confidenceGrade(score),
    hasOracle,
    hasKnownBad,
    hasBudget,
    hasVisualContract,
    hasProofBackstop,
    evidence,
    weaknesses,
  };
}

function summarizeEvidence(results: GraderResult[]): EvidenceCounts {
  const counts: EvidenceCounts = {
    deterministic: { passed: 0, total: 0 },
    trace: { passed: 0, total: 0 },
    visual: { passed: 0, total: 0 },
    llm_judge: { passed: 0, total: 0 },
    manual: { passed: 0, total: 0 },
  };
  for (const result of results) {
    const tier = result.evidenceTier ?? evidenceTierForSpec(result.spec);
    counts[tier].total += 1;
    if (result.passed) counts[tier].passed += 1;
  }
  return counts;
}

function evidenceTierForSpec(spec: GraderSpec): EvidenceTier {
  switch (spec.type) {
    case "step":
      return "trace";
    case "rubric_llm":
      return "llm_judge";
    case "manual":
      return "manual";
    default:
      return "deterministic";
  }
}

function statusRatio(status: RunCaseRecord["status"]) {
  return status === "passed" ? 1 : status === "pending" || status === "running" || status === "grading" ? 0.5 : 0;
}

function ratio(passed: number, total: number) {
  return total > 0 ? passed / total : 0;
}

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

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function confidenceGrade(score: number) {
  if (score >= 90) return "High confidence";
  if (score >= 75) return "Solid confidence";
  if (score >= 60) return "Needs review";
  return "Weak proof";
}

const GRADER_TIER_COLOR: Record<string, string> = {
  exit_code: "bg-ok/10 text-ok",
  tests_pass: "bg-ok/10 text-ok",
  file_contains: "bg-ok/10 text-ok",
  file_exists: "bg-ok/10 text-ok",
  file_eq: "bg-ok/10 text-ok",
  regex_match: "bg-ok/10 text-ok",
  json_path: "bg-ok/10 text-ok",
  files_unchanged: "bg-ok/10 text-ok",
  git_diff_contains: "bg-ok/10 text-ok",
  checksum: "bg-ok/10 text-ok",
  file_deleted: "bg-ok/10 text-ok",
  step: "bg-accent/10 text-accent-soft",
  rubric_llm: "bg-warn/10 text-warn",
  manual: "bg-bg-elev text-fg-dim",
};

function GraderRow({ g }: { g: GraderResult }) {
  const summary = g.detail.length > 120 ? `${g.detail.slice(0, 120)}…` : g.detail;
  const expected = g.spec.type === "file_eq" ? g.spec.expected : g.spec.type === "file_contains" ? g.spec.pattern : undefined;
  const actual = g.output ?? "";
  const showDiff = (g.spec.type === "file_eq" || g.spec.type === "file_contains") && !g.passed && actual;

  return (
    <details className="group relative">
      <summary className="relative pl-4 pr-4 py-2.5 cursor-pointer hover:bg-bg-elev flex items-start gap-2 list-none">
        <div className={clsx("absolute left-0 top-2 bottom-2 w-0.5 rounded-full", g.passed ? "bg-ok" : "bg-err")} />
        <ChevronRight className="size-3.5 text-fg-dim mt-0.5 group-open:rotate-90 transition-transform" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={clsx("font-mono text-[11px] px-1.5 py-0.5 rounded", GRADER_TIER_COLOR[g.spec.type] ?? "bg-bg-elev")}>{g.spec.type}</span>
            <span className={clsx("text-[10px] px-1.5 py-0.5 rounded-full border", g.passed ? "text-ok border-ok/30 bg-ok/10" : "text-err border-err/30 bg-err/10")}>
              {g.passed ? "passed" : "failed"}
            </span>
            <span className="text-[10px] text-fg-dim mono tabular-nums">{g.durationMs}ms</span>
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
}

function Mini({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <div className="card p-3">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-fg-muted mb-1">
        <Icon className="size-3" /> {label}
      </div>
      <div className="text-sm font-medium mono tabular-nums">{value}</div>
    </div>
  );
}
