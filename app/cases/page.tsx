import Link from "next/link";
import { loadCases } from "@/lib/cases";
import { Tags, FileText, Wrench } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CasesPage({ searchParams }: { searchParams: { category?: string } }) {
  const all = await loadCases();
  const filterCat = searchParams.category;
  const cases = filterCat ? all.filter((c) => c.category === filterCat) : all;
  const grouped = cases.reduce<Record<string, typeof cases>>((a, c) => { (a[c.category] ||= []).push(c); return a; }, {});

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Cases</h1>
        <p className="text-sm text-fg-muted mt-1">Test library. {all.length} cases across {Object.keys(grouped).length} categories.</p>
      </header>

      {!filterCat && (
        <nav className="flex flex-wrap gap-2 mb-6">
          <Link href="/cases" className="text-[11px] px-2 py-1 rounded-md border border-bd text-fg-muted hover:bg-bg-elev mono">all</Link>
          {Object.entries(grouped).map(([cat, list]) => (
            <Link key={cat} href={`/cases?category=${cat}`} className="text-[11px] px-2 py-1 rounded-md border border-bd text-fg-muted hover:bg-bg-elev mono">
              {cat} · {list.length}
            </Link>
          ))}
        </nav>
      )}

      <div className="space-y-8">
        {Object.entries(grouped).map(([cat, list]) => (
          <section key={cat}>
            <div className="flex items-baseline gap-2 mb-3">
              <h2 className="text-sm font-medium uppercase tracking-wider text-fg-muted">{cat}</h2>
              <span className="text-[11px] text-fg-dim mono">{list.length}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {list.map((c) => (
                <div key={c.id} className="card p-4 hover:bg-bg-elev transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{c.name}</div>
                      <div className="text-[10px] text-fg-dim mono mt-0.5">{c.id}</div>
                    </div>
                    <span className="text-[10px] text-fg-muted mono px-1.5 py-0.5 rounded bg-bg-elev flex items-center gap-1">
                      <Wrench className="size-2.5" /> {c.graders.length}
                    </span>
                  </div>
                  {c.description && <p className="text-[11px] text-fg-muted mt-2 line-clamp-2">{c.description}</p>}
                  {c.tags && c.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {c.tags.map((t) => <span key={t} className="text-[10px] text-fg-dim mono">#{t}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}