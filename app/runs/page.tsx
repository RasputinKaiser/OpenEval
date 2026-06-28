import Link from "next/link";
import { listRuns } from "@/lib/db";
import StatusBadge from "@/components/StatusBadge";
import HarnessBadge from "@/components/HarnessBadge";

export const dynamic = "force-dynamic";


export default async function Page() {
  const runs = listRuns(50);
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
          <p className="text-sm text-fg-muted mt-1">Recent evaluation runs.</p>
        </div>
        <Link href="/runs/new" className="text-sm text-accent-soft hover:underline">New run</Link>
      </header>
      {runs.length === 0 ? (
        <div className="card p-8 text-center text-sm text-fg-muted">
          No runs yet. <Link href="/runs/new" className="text-accent-soft hover:underline">Start one</Link>.
        </div>
      ) : (
        <div className="card overflow-hidden">
          {runs.map((r) => (
            <div key={r.id} className="px-4 py-3 border-b border-bd-subtle last:border-0 flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <Link href={`/runs/${r.id}`} className="font-medium hover:text-accent-soft truncate block">{r.name}</Link>
                <div className="text-[11px] text-fg-dim mono mt-0.5 flex items-center gap-1.5 flex-wrap">
                  {new Date(r.created_at).toLocaleString()} · {r.params.runner}
                  {r.params.harness && <HarnessBadge harness={r.params.harness} />}
                  <span>· {r.params.parallel}×</span>
                  {r.params.samples && r.params.samples > 1 ? <span>· {r.params.samples} samples</span> : null}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {r.summary && (
                  <span className={`text-sm mono font-semibold ${r.summary.passRate >= 1 ? "text-ok" : "text-err"}`}>
                    {(r.summary.passRate * 100).toFixed(0)}%
                  </span>
                )}
                <StatusBadge status={r.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
