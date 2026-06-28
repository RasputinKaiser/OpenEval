import { notFound } from "next/navigation";
import { getRun } from "@/lib/db";
import BenchClient from "@/components/BenchClient";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: { id: string } }) {
  const run = getRun(params.id);
  if (!run) notFound();
  return <BenchClient runId={params.id} runName={run.name} />;
}
