import Link from "next/link";
import { Activity, Plus } from "lucide-react";
import { listRuns } from "@/lib/db";
import RunsClient from "@/components/RunsClient";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function Page() {
  const runs = listRuns(50);
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <PageHeader
        icon={Activity}
        title="Runs"
        subtitle="Recent evaluation runs."
        actions={
          <Link href="/runs/new" className="flex items-center gap-1.5 rounded-md border border-bd px-2.5 py-1.5 text-sm text-fg-muted hover:bg-bg-elev hover:text-fg transition-colors">
            <Plus className="size-3.5" /> New run
          </Link>
        }
      />
      {runs.length === 0 ? (
        <div className="card p-8 text-center text-sm text-fg-muted">
          No runs yet. <Link href="/runs/new" className="text-accent-soft hover:underline">Start one</Link>.
        </div>
      ) : (
        <RunsClient runs={runs} />
      )}
    </div>
  );
}