import Link from "next/link";
import { countRuns, listRuns } from "@/lib/db";
import { loadCases } from "@/lib/cases";
import StatusBadge from "@/components/StatusBadge";
import HarnessBadge from "@/components/HarnessBadge";
import { Activity, ArrowRight, BarChart3, CheckCircle2, Cpu, DollarSign, FileText, Timer } from "lucide-react";

export const dynamic = "force-dynamic";

function fmtDuration(ms: number) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000), s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

export default async function Page() {
  const runs = listRuns(5);
  const totalRuns = countRuns();
  const cases = await loadCases();
  const lastRun = runs[0];
  const summary = lastRun?.summary;

  const stats = [
    { label: "Total Runs", value: totalRuns, icon: Activity },
    { label: "Test Cases", value: cases.length, icon: FileText },
    { label: "Last Pass Rate", value: summary ? `${(summary.passRate * 100).toFixed(0)}%` : "—", icon: CheckCircle2 },
    { label: "Avg Tokens (last)", value: summary ? `${((summary.totalTokensIn + summary.totalTokensOut) / Math.max(summary.total, 1)).toFixed(0)}` : "—", icon: Cpu },
  ];

  const byCat = cases.reduce<Record<string, number>>((a, c) => { a[c.category] = (a[c.category] || 0) + 1; return a; }, {});

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-fg-muted mt-1">Evaluate agent CLIs across SWE, single-tool, reasoning, and visual-code tasks.</p>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="card p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-fg-muted">{s.label}</span>
                <Icon className="size-4 text-fg-dim" />
              </div>
              <div className="text-2xl font-semibold mt-2 mono">{s.value}</div>
            </div>
          );
        })}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium">Recent runs</h2>
            <Link href="/runs" className="text-xs text-accent-soft hover:underline inline-flex items-center gap-1">
              View all <ArrowRight className="size-3" />
            </Link>
          </div>
          {runs.length === 0 ? (
            <div className="text-sm text-fg-muted py-10 text-center">
              No runs yet. <Link href="/runs/new" className="text-accent-soft hover:underline">Start one</Link>.
            </div>
          ) : (
            <div className="space-y-1.5">
              {runs.map((r) => (
                <div key={r.id} className="px-3 py-2.5 rounded-md border border-transparent hover:border-bd-subtle transition-colors">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3">
                    <div className="min-w-0">
                      <Link href={`/runs/${r.id}`} className="font-medium text-sm truncate block hover:text-accent-soft">{r.name}</Link>
                      <div className="text-[11px] text-fg-dim mono mt-0.5 flex items-center gap-1.5 flex-wrap">
                        {new Date(r.created_at).toLocaleString()} · {r.params.runner}
                        {r.params.harness && <HarnessBadge harness={r.params.harness} />}
                        <span>· {r.params.parallel}×</span>
                        {r.params.samples && r.params.samples > 1 ? <span>· {r.params.samples} samples</span> : null}
                      </div>
                    </div>
                    <Link href={`/runs/${r.id}`} className="flex items-center gap-3 shrink-0 hover:text-accent-soft transition-colors" aria-label={`Open ${r.name}`}>
                      {r.summary && (
                        <div className="text-right">
                          <div className="text-sm font-semibold mono">
                            {r.summary.passed}/{r.summary.total}
                          </div>
                          <div className="text-[10px] text-fg-dim">
                            {(r.summary.passRate * 100).toFixed(0)}%
                          </div>
                        </div>
                      )}
                      <StatusBadge status={r.status} />
                    </Link>
                    <Link href={`/runs/${r.id}/bench`} className="min-h-8 min-w-8 flex items-center justify-center text-fg-dim hover:text-accent-soft transition-colors" aria-label={`Open bench for ${r.name}`}>
                      <BarChart3 className="size-4" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-medium mb-4">Case library</h2>
          <div className="space-y-3">
            {Object.entries(byCat).map(([cat, count]) => (
              <Link key={cat} href={`/cases?category=${cat}`} className="block">
                <div className="flex items-center justify-between">
                  <span className="text-sm">{cat}</span>
                  <span className="text-xs text-fg-muted mono">{count}</span>
                </div>
                <div className="mt-1.5 h-1.5 bg-bg-elev rounded-full overflow-hidden">
                  <div className="h-full bg-accent" style={{ width: `${(count / cases.length) * 100}%` }} />
                </div>
              </Link>
            ))}
          </div>
          <div className="mt-5 pt-4 border-t border-bd">
            <Link href="/cases" className="text-xs text-accent-soft hover:underline inline-flex items-center gap-1">
              Browse all cases <ArrowRight className="size-3" />
            </Link>
          </div>
        </section>
      </div>

      {summary && (
        <section className="card p-5 mt-4">
          <h2 className="text-sm font-medium mb-4">Last run breakdown</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Mini label="Total duration" value={fmtDuration(summary.totalDurationMs)} icon={Timer} />
            <Mini label="Total cost" value={`$${summary.totalCostUsd.toFixed(4)}`} icon={DollarSign} />
            <Mini label="Tokens in" value={summary.totalTokensIn.toLocaleString()} icon={Cpu} />
            <Mini label="Tokens out" value={summary.totalTokensOut.toLocaleString()} icon={Cpu} />
          </div>
        </section>
      )}
    </div>
  );
}

function Mini({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <div className="border border-bd rounded-md p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-fg-muted mb-1">
        <Icon className="size-3" /> {label}
      </div>
      <div className="text-base font-medium mono">{value}</div>
    </div>
  );
}
