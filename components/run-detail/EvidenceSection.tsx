"use client";

import { memo } from "react";
import clsx from "clsx";
import { Boxes, ChevronRight, Eye, Fingerprint, Scale, SearchCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { EvidenceTier, GraderResult } from "@/lib/types";
import { summarizeEvidence } from "./trust";

/** Evidence-tier grouping cards + per-grader result rows with diff view. */

export function EvidenceGroupSummary({ results, visualContract }: { results: GraderResult[]; visualContract: boolean }) {
  const grouped = summarizeEvidence(results);
  const rawCards: Array<{ tier: EvidenceTier; label: string; icon: LucideIcon; passed: number; total: number }> = [
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

export const GraderRow = memo(function GraderRow({ g }: { g: GraderResult }) {
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
          <DiffView expected={expected !== undefined ? String(expected) : ""} actual={actual} />
        ) : g.output ? (
          <div>
            <div className="text-[10px] uppercase text-fg-dim mb-1">Output</div>
            <pre className="text-[11px] mono text-fg-dim bg-bg p-2 rounded border border-bd-subtle overflow-auto max-h-96 whitespace-pre-wrap break-words">{g.output}</pre>
          </div>
        ) : null}
      </div>
    </details>
  );
});

function DiffView({ expected, actual }: { expected: string; actual: string }) {
  const expLines = expected.split("\n");
  const actLines = actual.split("\n");
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      <DiffColumn label="Expected" lines={expLines} other={actLines} />
      <DiffColumn label="Actual" lines={actLines} other={expLines} />
    </div>
  );
}

function DiffColumn({ label, lines, other }: { label: string; lines: string[]; other: string[] }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-fg-dim mb-1">{label}</div>
      <div className="rounded border border-bd-subtle overflow-auto max-h-96 bg-bg">
        {lines.map((line, i) => {
          const changed = i >= other.length || other[i] !== line;
          return (
            <div key={i} className={clsx("flex", changed && "bg-err/5")}>
              <span className="text-fg-dim mono text-[9px] w-6 shrink-0 text-right pr-2 select-none">{i + 1}</span>
              <span className={clsx("text-[10px] mono whitespace-pre-wrap break-all flex-1", changed ? "text-err/80" : "text-fg-muted")}>{line || " "}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
