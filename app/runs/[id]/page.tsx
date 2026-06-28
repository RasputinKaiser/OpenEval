import { notFound } from "next/navigation";
import { getRun, listRunCases } from "@/lib/db";
import RunDetailClient from "@/components/RunDetailClient";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: { id: string } }) {
  const run = getRun(params.id);
  if (!run) notFound();
  const cases = listRunCases(params.id);
  const harnessInfo = cases.find((c) => c.harness_info)?.harness_info;
  return (
    <main className="p-4 max-w-7xl mx-auto">
      <RunDetailClient
        runId={params.id}
        runName={run.name}
        initialCases={cases}
        running={run.status === "running"}
        model={run.params.model}
        harness={run.params.harness}
        harnessInfo={harnessInfo}
      />
    </main>
  );
}
