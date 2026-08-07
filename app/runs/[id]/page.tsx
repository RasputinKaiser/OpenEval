import { notFound } from "next/navigation";
import { getRun, listRunCases } from "@/lib/db";
import RunDetailClient from "@/components/RunDetailClient";
import EvaluateNav from "@/components/EvaluateNav";

export const dynamic = "force-dynamic";

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const run = getRun(params.id);
  if (!run) notFound();
  const cases = listRunCases(params.id);
  const harnessInfo = cases.find((c) => c.harness_info)?.harness_info;
  return (
    <main className="p-4 max-w-7xl mx-auto">
      <EvaluateNav />
      <RunDetailClient
        runId={params.id}
        runName={run.name}
        initialCases={cases}
        running={run.status === "running"}
        createdAt={run.created_at}
        endedAt={run.ended_at}
        model={run.params.model}
        harness={run.params.harness}
        judge={run.params.judge}
        harnessInfo={harnessInfo}
      />
    </main>
  );
}
