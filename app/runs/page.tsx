import Link from "next/link";
import { listRuns } from "@/lib/db";
import RunsClient from "@/components/RunsClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const runs = listRuns(50);
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
          <p className="text-sm text-fg-muted mt-1">Recent evaluation runs.</p>
        </div>
        <Link href="/runs/new" className="text-sm text-accent-soft hover:underline">New run</Link>
      </header>
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