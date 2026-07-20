"use client";

import clsx from "clsx";
import { FlaskConical, SearchCheck, ShieldAlert, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { RunConfidenceSummary } from "./trust";

/** Run-level confidence layer: proof coverage, adversarial coverage, weakness radar. */
export default function RunConfidencePanel({ confidence }: { confidence: RunConfidenceSummary }) {
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
  icon: LucideIcon;
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
