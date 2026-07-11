import Link from "next/link";
import clsx from "clsx";
import { FileText } from "lucide-react";
import { loadCases } from "@/lib/cases";
import CasesClient from "@/components/CasesClient";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function CasesPage(props: { searchParams: Promise<{ category?: string }> }) {
  const searchParams = await props.searchParams;
  const all = await loadCases();
  const filterCat = searchParams.category;
  const categories = Array.from(new Set(all.map((c) => c.category)));

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <PageHeader icon={FileText} title="Cases" subtitle={`Test library. ${all.length} cases across ${categories.length} categories.`} />

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