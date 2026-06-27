import { auditCases, evidenceLabel } from "@/lib/accuracy";
import { loadCases } from "@/lib/cases";
import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AccuracyPage() {
  const cases = await loadCases();
  const audit = auditCases(cases);
  const oraclePct = pct(audit.oracleCases, audit.totalCases);
  const deterministicPct = pct(audit.deterministicOrTraceCases, audit.totalCases);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ShieldCheck className="size-6 text-accent-soft" /> Accuracy audit
        </h1>
        <p className="text-sm text-fg-muted mt-1">
          Measures benchmark trust surfaces: oracle coverage, no-op rejection readiness, evidence tiers, and visual contracts.
        </p>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Oracle coverage" value={`${oraclePct}%`} sub={`${audit.oracleCases}/${audit.totalCases} cases`} />
        <Stat label="Deterministic/trace" value={`${deterministicPct}%`} sub={`${audit.deterministicOrTraceCases}/${audit.totalCases} cases`} />
        <Stat label="Known-bad scripts" value={`${audit.knownBadCases}`} sub="explicit adversarial fixtures" />
        <Stat label="Weak cases" value={`${audit.weakCases}`} sub="need stronger proof" tone={audit.weakCases ? "warn" : "ok"} />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        <div className="space-y-4">
          <section className="card p-5">
            <h2 className="text-sm font-medium mb-3">Evidence mix</h2>
            <div className="space-y-2">
              {Object.entries(audit.tierTotals).map(([tier, count]) => (
                <div key={tier} className="flex items-center justify-between text-sm">
                  <span className="text-fg-muted">{evidenceLabel(tier as any)}</span>
                  <span className="mono">{count}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-medium mb-2">Visual evaluation boundary</h2>
            <p className="text-xs text-fg-muted leading-relaxed">
              Vision input and visual-code output are separate capabilities. A text-only model can still be evaluated on generated SVG,
              Three.js, web UI, and app UI artifacts as long as the verifier inspects rendered output externally.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <Mini label="Visual contracts" value={String(audit.visualCases)} />
              <Mini label="Vision input" value={String(audit.visionInputCases)} />
            </div>
          </section>
        </div>

        <section className="card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-bd-subtle text-sm font-medium">Case proof quality</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-fg-muted bg-bg-subtle">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Case</th>
                  <th className="text-left px-4 py-2 font-medium">Oracle</th>
                  <th className="text-left px-4 py-2 font-medium">Known bad</th>
                  <th className="text-left px-4 py-2 font-medium">Evidence</th>
                  <th className="text-left px-4 py-2 font-medium">Weaknesses</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bd-subtle">
                {audit.cases.map((row) => (
                  <tr key={row.id} className="hover:bg-bg-elev">
                    <td className="px-4 py-2">
                      <div className="font-medium">{row.name}</div>
                      <div className="text-[10px] text-fg-dim mono">{row.id} · {row.category} · {row.difficulty}</div>
                    </td>
                    <td className="px-4 py-2"><Bool ok={row.hasOracle} /></td>
                    <td className="px-4 py-2"><Bool ok={row.hasKnownBad} /></td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(row.tiers).filter(([, count]) => count > 0).map(([tier, count]) => (
                          <span key={tier} className="text-[10px] mono px-1.5 py-0.5 rounded bg-bg-elev text-fg-muted">
                            {evidenceLabel(tier as any)} {count}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2 max-w-md">
                      {row.weaknesses.length ? (
                        <div className="flex flex-wrap gap-1">
                          {row.weaknesses.map((w) => <span key={w} className="text-[10px] text-warn mono px-1.5 py-0.5 rounded bg-warn/10">{w}</span>)}
                        </div>
                      ) : <span className="text-xs text-ok">covered</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "ok" | "warn" }) {
  const c = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-fg";
  return (
    <div className="card p-4">
      <div className="text-[10px] uppercase tracking-wider text-fg-muted mb-1">{label}</div>
      <div className={`text-xl font-semibold mono ${c}`}>{value}</div>
      <div className="text-[11px] text-fg-dim mt-0.5">{sub}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-bd-subtle p-2">
      <div className="text-[10px] uppercase tracking-wider text-fg-muted">{label}</div>
      <div className="mono text-sm mt-0.5">{value}</div>
    </div>
  );
}

function Bool({ ok }: { ok: boolean }) {
  return ok
    ? <span className="inline-flex items-center gap-1 text-xs text-ok"><CheckCircle2 className="size-3.5" /> yes</span>
    : <span className="inline-flex items-center gap-1 text-xs text-fg-dim"><XCircle className="size-3.5" /> no</span>;
}

function pct(n: number, d: number) {
  return d ? Math.round((n / d) * 100) : 0;
}
