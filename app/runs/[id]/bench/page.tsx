import { notFound } from "next/navigation";
import { getRun } from "@/lib/db";
import BenchClient from "@/components/BenchClient";

export const dynamic = "force-dynamic";

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const run = getRun(params.id);
  if (!run) notFound();
  return <BenchClient runId={params.id} runName={run.name} />;
}
