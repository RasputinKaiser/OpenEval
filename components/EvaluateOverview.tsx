import Link from "next/link";
import {
  ArrowRight,
  FileText,
  GitCompareArrows,
  Play,
  ShieldCheck,
} from "lucide-react";
import type { RunSummary } from "@/lib/types";

export interface EvaluateOverviewProps {
  totalRuns: number;
  latestRunSummary: RunSummary | null;
  latestRunName: string | null;
  latestRunId: string | null;
  caseCount: number;
}

const WORKFLOW_LINKS = [
  {
    href: "/runs/new",
    label: "New Run",
    description: "Launch an evaluation",
    icon: Play,
  },
  {
    href: "/accuracy",
    label: "Accuracy",
    description: "Audit case evidence",
    icon: ShieldCheck,
  },
  {
    href: "/runs/compare",
    label: "Compare",
    description: "Find regressions",
    icon: GitCompareArrows,
  },
  {
    href: "/cases",
    label: "Cases",
    description: "Curate the suite",
    icon: FileText,
  },
] as const;

export default function EvaluateOverview({
  totalRuns,
  latestRunSummary,
  latestRunName,
  latestRunId,
  caseCount,
}: EvaluateOverviewProps) {
  const hasLatestRun = Boolean(latestRunId);
  const latestRunLabel = latestRunName?.trim() || "Latest evaluation";
  const latestRunDetails = latestRunSummary
    ? `${latestRunSummary.passed} passed · ${latestRunSummary.failed} failed · ${latestRunSummary.errored} errored`
    : "Summary unavailable; inspect the run for details.";

  return (
    <section className="card mb-5 p-5 md:p-6" aria-labelledby="evaluate-overview-title">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-md bg-accent/10">
              <Play className="size-3.5 text-accent-soft" />
            </span>
            <h2 id="evaluate-overview-title" className="text-base font-semibold tracking-tight">
              Evaluate
            </h2>
          </div>
          <p className="mt-1.5 max-w-[58ch] text-sm leading-5 text-fg-muted">
            Run the suite, check what it can prove, and compare the evidence that changes.
          </p>

          <div className="mt-4 grid max-w-xl grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Evaluation overview">
            <OverviewStat label="Runs" value={String(totalRuns)} />
            <OverviewStat label="Cases" value={String(caseCount)} />
            <div className="col-span-2 min-w-0 rounded-lg border border-bd-subtle bg-bg-elev/50 px-3 py-2 sm:col-span-1">
              <div className="text-[10px] uppercase tracking-[0.12em] text-fg-dim">Latest</div>
              {hasLatestRun ? (
                <Link href={`/runs/${encodeURIComponent(latestRunId as string)}`} className="mt-1 block min-w-0 rounded-sm text-xs font-medium text-accent-soft hover:underline focus-visible:outline-none">
                  <span className="block truncate">{latestRunLabel}</span>
                  <span className="mt-0.5 block truncate text-[10px] font-normal text-fg-dim mono" title={latestRunDetails}>
                    {latestRunDetails}
                  </span>
                </Link>
              ) : (
                <span className="mt-1 block text-xs text-fg-muted">No run recorded yet</span>
              )}
            </div>
          </div>
        </div>

        <nav className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:w-[25rem]" aria-label="Evaluate actions">
          {WORKFLOW_LINKS.map(({ href, label, description, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="interactive-card group flex min-w-0 items-center gap-3 rounded-lg border border-bd-subtle bg-bg-elev/45 px-3 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-md bg-accent/10 text-accent-soft">
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{label}</span>
                <span className="block truncate text-[11px] text-fg-dim">{description}</span>
              </span>
              <ArrowRight aria-hidden="true" className="size-3.5 shrink-0 text-fg-dim transition-transform group-hover:translate-x-0.5 group-hover:text-accent-soft" />
            </Link>
          ))}
        </nav>
      </div>
    </section>
  );
}

function OverviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-bd-subtle bg-bg-elev/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.12em] text-fg-dim">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums mono">{value}</div>
    </div>
  );
}
