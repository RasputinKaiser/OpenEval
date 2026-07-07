import { notFound } from "next/navigation";
import { listRunCases } from "@/lib/db";
import CaseDetailClient from "@/components/CaseDetailClient";

export const dynamic = "force-dynamic";

export default async function Page(props: { params: Promise<{ id: string; caseId: string }> }) {
  const params = await props.params;
  const cases = listRunCases(params.id);
  const rc = cases.find((item) => item.case_id === params.caseId || item.id === params.caseId) ?? null;
  if (!rc) notFound();
  return (
    <main className="p-8 max-w-5xl mx-auto">
      <CaseDetailClient runId={params.id} caseId={params.caseId} initial={rc} />
    </main>
  );
}
