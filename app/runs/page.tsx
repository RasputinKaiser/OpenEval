import Link from "next/link";
import { Activity, Plus } from "lucide-react";
import { countRuns, listRuns } from "@/lib/db";
import { loadCases } from "@/lib/cases";
import RunsClient from "@/components/RunsClient";
import PageHeader from "@/components/PageHeader";
import EvaluateNav from "@/components/EvaluateNav";
import EvaluateOverview from "@/components/EvaluateOverview";

export const dynamic = "force-dynamic";

export default async function Page() {
  const runs = listRuns(50);
  const cases = await loadCases();
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <PageHeader
        icon={Activity}
        title="Runs"
        subtitle="Track suite executions, inspect evidence, and choose the next comparison."
        actions={
          <Link href="/runs/new" className="flex items-center gap-1.5 rounded-md border border-bd px-2.5 py-1.5 text-sm text-fg-muted hover:bg-bg-elev hover:text-fg transition-colors">
            <Plus className="size-3.5" /> New run
          </Link>
        }
      />
      <EvaluateNav />
      {runs.length === 0 ? (
        <div className="card p-8 text-center text-sm text-fg-muted">
          No runs yet. <Link href="/runs/new" className="text-accent-soft hover:underline">Start one</Link>.
        </div>
      ) : (
        <RunsClient runs={runs} />
      )}
      <details className="mt-6"><summary className="cursor-pointer text-xs text-fg-muted mb-3">Evaluation overview and shortcuts</summary>
      <EvaluateOverview
        totalRuns={countRuns()}
        caseCount={cases.length}
        latestRunId={runs[0]?.id ?? null}
        latestRunName={runs[0]?.name ?? null}
        latestRunSummary={runs[0]?.summary ?? null}
      />
      </details>
    </div>
  );
}
