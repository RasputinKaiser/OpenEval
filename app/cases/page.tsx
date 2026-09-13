import Link from "next/link";
import { ArrowRight, FileText, Sparkles } from "lucide-react";
import { loadCases } from "@/lib/cases";
import CasesClient from "@/components/CasesClient";
import PageHeader from "@/components/PageHeader";
import EvaluateNav from "@/components/EvaluateNav";

export const dynamic = "force-dynamic";

export default async function CasesPage(props: { searchParams: Promise<{ category?: string; q?: string }> }) {
  const searchParams = await props.searchParams;
  const all = await loadCases();
  const filterCat = searchParams.category;
  const categories = Array.from(new Set(all.map((c) => c.category)));

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <PageHeader icon={FileText} title="Cases" subtitle={`${all.length} evaluation tasks across ${categories.length} categories. Inspect a task, then choose it for a run.`} />
      <EvaluateNav />

      <section className="case-starter mb-5 rounded-xl border p-4 sm:p-5" aria-labelledby="case-starter-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-accent-soft" aria-hidden="true" />
              <h2 id="case-starter-title" className="text-sm font-semibold">Not sure where to begin?</h2>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-fg-muted">
              The Core suite covers coding, tool use, and reasoning. For visual tasks, choose the Creative sampler on New Run. You can review the selection and settings before starting.
            </p>
          </div>
          <Link href="/runs/new" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            Set up Core suite <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <CasesClient cases={all} activeCategory={filterCat} />
    </div>
  );
}
