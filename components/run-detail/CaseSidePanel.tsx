"use client";

import Link from "next/link";
import clsx from "clsx";
import StatusBadge from "../StatusBadge";
import CopyButton from "./CopyButton";
import CollapsibleCard from "./CollapsibleCard";
import ArtifactStage from "./ArtifactSection";
import Transcript from "./TranscriptSection";
import { EvidenceGroupSummary, GraderRow } from "./EvidenceSection";
import {
  AlertCircle, BadgeCheck, Boxes, CheckCircle2, ChevronRight, Clock, Cpu, DollarSign, Eye, Gauge, Hash,
  ShieldAlert, ShieldCheck, XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { RunCaseRecord } from "@/lib/types";
import { presentRunnerCost } from "@/lib/cost-display";
import { summarizeCaseTrust, type CaseTrustSummary } from "./trust";
import type { CollapsedMap } from "./collapse";

/** Right-hand reading panel for the selected case: trust, evidence, artifact, transcript, answer, tools. */
export default function CaseSidePanel({
  rc,
  runId,
  collapsed,
  onToggleSection,
}: {
  rc: RunCaseRecord;
  runId: string;
  collapsed: CollapsedMap;
  onToggleSection: (section: string) => void;
}) {
  const runner = rc.runner_result;
  const cost = runner ? presentRunnerCost(runner.usage) : null;
  const grader = rc.grader_result;
  const trust = summarizeCaseTrust(rc);
  const jumps = [
    ...(grader && grader.results.length > 0 ? [{ id: "case-graders", section: "graders", label: "Graders" }] : []),
    ...(rc.case_def?.visual?.expected_artifacts?.length ? [{ id: "case-artifact", section: "artifact", label: "Artifact" }] : []),
    ...(runner && runner.transcript.length > 0 ? [{ id: "case-transcript", section: "transcript", label: "Transcript" }] : []),
    ...(runner?.finalText ? [{ id: "case-answer", section: "answer", label: "Answer" }] : []),
    ...(runner && runner.toolCalls.length > 0 ? [{ id: "case-tools", section: "tools", label: "Tools" }] : []),
  ];
  function jumpTo(j: { id: string; section: string }) {
    // A jump into a collapsed section expands it first; scroll next frame so
    // the revealed content has laid out.
    if (collapsed[j.section]) onToggleSection(j.section);
    requestAnimationFrame(() => {
      document.getElementById(j.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  return (
    <div className="space-y-3">
      <div className="card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold">{rc.case_name}</div>
            <div className="mt-0.5 flex items-center gap-0.5 text-[11px] text-fg-dim mono">
              <span className="truncate">{rc.case_id}</span>
              <CopyButton text={rc.case_id} label="Copy case id" />
            </div>
          </div>
          <StatusBadge status={rc.status} size="md" />
        </div>
        {jumps.length > 1 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {jumps.map((j) => (
              <a
                key={j.id}
                href={`#${j.id}`}
                onClick={(e) => { e.preventDefault(); jumpTo(j); }}
                className="rounded-full border border-bd px-2.5 py-1 text-[11px] text-fg-muted hover:bg-bg-elev hover:text-fg transition-colors"
              >
                {j.label}
              </a>
            ))}
          </div>
        )}
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
          <Mini label={cost!.label} value={cost!.value} icon={DollarSign} />
          <Mini label="Tokens in" value={runner.usage.inputTokens.toLocaleString()} icon={Cpu} />
          <Mini label="Tokens out" value={runner.usage.outputTokens.toLocaleString()} icon={Cpu} />
        </div>
      )}

      {grader && grader.results.length > 0 && (
        <CollapsibleCard
          id="case-graders"
          title="Evidence groups"
          collapsed={!!collapsed["graders"]}
          onToggle={() => onToggleSection("graders")}
          right={
            <span className={clsx("text-xs mono font-semibold", grader.passed ? "text-ok" : "text-err")}>
              {(grader.passRatio * 100).toFixed(0)}%
            </span>
          }
        >
          <EvidenceGroupSummary results={grader.results} visualContract={!!rc.case_def.visual} />
          <div className="divide-y divide-bd-subtle">
            {grader.results.map((g, i) => (
              <GraderRow key={i} g={g} />
            ))}
          </div>
        </CollapsibleCard>
      )}

      {rc.case_def?.visual?.expected_artifacts?.length ? (
        <div id="case-artifact" className="scroll-mt-3">
          <ArtifactStage
            artifacts={rc.case_def.visual.expected_artifacts}
            caseId={rc.case_id}
            runId={runId}
            status={rc.status}
            collapsed={!!collapsed["artifact"]}
            onToggle={() => onToggleSection("artifact")}
          />
        </div>
      ) : null}

      {runner && runner.transcript.length > 0 && (
        <CollapsibleCard
          id="case-transcript"
          title={`Transcript (${runner.transcript.length})`}
          collapsed={!!collapsed["transcript"]}
          onToggle={() => onToggleSection("transcript")}
        >
          <Transcript transcript={runner.transcript} />
        </CollapsibleCard>
      )}

      {runner && runner.finalText && (
        <CollapsibleCard
          id="case-answer"
          title="Final answer"
          collapsed={!!collapsed["answer"]}
          onToggle={() => onToggleSection("answer")}
          right={<CopyButton text={runner.finalText} label="Copy final answer" />}
        >
          <pre className="p-4 text-[12px] mono text-fg whitespace-pre-wrap max-h-64 overflow-y-auto">{runner.finalText}</pre>
        </CollapsibleCard>
      )}

      {runner && runner.toolCalls.length > 0 && (
        <CollapsibleCard
          id="case-tools"
          title={`Tool calls (${runner.toolCalls.length})`}
          collapsed={!!collapsed["tools"]}
          onToggle={() => onToggleSection("tools")}
        >
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
        </CollapsibleCard>
      )}

      <div className="text-center">
        <Link href={`/runs/${runId}/case/${rc.case_id}`} className="text-xs text-accent-soft hover:underline">Open full transcript →</Link>
      </div>
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

function MiniProof({ label, value, icon: Icon, ok }: { label: string; value: string; icon: LucideIcon; ok?: boolean }) {
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

function Mini({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  return (
    <div className="card p-3">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-fg-muted mb-1">
        <Icon className="size-3" /> {label}
      </div>
      <div className="text-sm font-medium mono tabular-nums">{value}</div>
    </div>
  );
}
