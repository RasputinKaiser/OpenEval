import { notFound } from "next/navigation";
import { getRun } from "@/lib/db";
import BenchClient from "@/components/BenchClient";
import EvaluateNav from "@/components/EvaluateNav";

export const dynamic = "force-dynamic";

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const run = getRun(params.id);
  if (!run) notFound();
  return (
    <div className="w-full">
      <EvaluateNav />
      <BenchClient
        runId={params.id}
        runName={run.name}
        model={run.params.model}
        status={run.status}
        createdAt={run.created_at}
      />
    </div>
  );
}
