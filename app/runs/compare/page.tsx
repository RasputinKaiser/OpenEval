import { listRuns } from "@/lib/db";
import CompareClient from "@/components/CompareClient";

export const dynamic = "force-dynamic";

export default async function Page(props: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const searchParams = await props.searchParams;
  const runs = listRuns(50).map((run) => ({
    id: run.id,
    name: run.name,
    createdAt: run.created_at,
    status: run.status,
    passRate: run.summary?.passRate ?? null,
    model: run.params.model,
  }));
  return <CompareClient runs={runs} initialA={searchParams.a} initialB={searchParams.b} />;
}
