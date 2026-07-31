import Link from "next/link";
import clsx from "clsx";
import { ArrowRight, FileText, Sparkles } from "lucide-react";
import { loadCases } from "@/lib/cases";
import CasesClient from "@/components/CasesClient";
import PageHeader from "@/components/PageHeader";
import EvaluateNav from "@/components/EvaluateNav";

export const dynamic = "force-dynamic";

export default async function CasesPage(props: { searchParams: Promise<{ category?: string }> }) {
  const searchParams = await props.searchParams;
  const all = await loadCases();
  const filterCat = searchParams.category;
  const categories = Array.from(new Set(all.map((c) => c.category)));

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <PageHeader icon={FileText} title="Cases" subtitle={`Benchmark library. ${all.length} cases across ${categories.length} categories.`} />
      <EvaluateNav />

      <section className="mb-5 rounded-lg border border-accent/30 bg-accent/10 p-4 sm:p-5" aria-labelledby="case-starter-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-accent-soft" aria-hidden="true" />
              <h2 id="case-starter-title" className="text-sm font-semibold">Not sure where to begin?</h2>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-fg-muted">
              Start with the bounded Core suite to sample deterministic SWE, tool, and reasoning behavior. Choose the Creative sampler from New Run when you want a small visual/artifact tour.
            </p>
          </div>
          <Link href="/runs/new" className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            Start with Core suite <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <nav className="flex flex-wrap gap-2 mb-6">
        <Link href="/cases" className={clsx("text-[11px] px-2.5 py-1.5 rounded-md border mono", !filterCat ? "border-accent bg-accent/10 text-accent-soft" : "border-bd text-fg-muted hover:bg-bg-elev")}>all</Link>
        {categories.map((cat) => {
          const count = all.filter((c) => c.category === cat).length;
          return (
            <Link key={cat} href={`/cases?category=${cat}`} className={clsx("text-[11px] px-2.5 py-1.5 rounded-md border mono", filterCat === cat ? "border-accent bg-accent/10 text-accent-soft" : "border-bd text-fg-muted hover:bg-bg-elev")}>
              {cat} · {count}
            </Link>
          );
        })}
      </nav>

      <CasesClient cases={all} activeCategory={filterCat} />
    </div>
  );
}
