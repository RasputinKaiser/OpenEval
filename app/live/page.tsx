import path from "node:path";
import LiveClient from "@/components/LiveClient";
import { scanLiveSessions, ncodeProjectsDir, getErroringTurns, type LiveAggregate, type TranscriptResult } from "@/lib/live";

export const dynamic = "force-dynamic";

async function getSessionTranscript(filePath: string): Promise<TranscriptResult> {
  "use server";
  const root = ncodeProjectsDir();
  const rel = path.relative(root, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel) || !filePath.endsWith(".jsonl")) {
    return { turns: [], error: "Invalid session path" };
  }
  try {
    return getErroringTurns(filePath);
  } catch (e) {
    return { turns: [], error: `Failed to parse session transcript: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export default function LivePage() {
  let data: LiveAggregate;
  let error: string | undefined;

  try {
    data = scanLiveSessions(200);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    data = {
      totalSessions: 0,
      totalProjects: 0,
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalToolCalls: 0,
      totalToolErrors: 0,
      sessionsWithMeasuredDuration: 0,
      sessionsWithMissingModel: 0,
      sessionsWithInferredModel: 0,
      sessionsWithMissingTokens: 0,
      sessionsWithMalformedLines: 0,
      staleSessions: 0,
      avgDataQuality: 0,
      scanWarnings: [],
      byModel: [],
      byTool: [],
      queueTotals: { enqueue: 0, dequeue: 0, remove: 0, popAll: 0, preview: [] },
      sidechainMessages: 0,
      agentSessions: 0,
      topBranches: [],
      topFiles: [],
      sessions: [],
    };
  }

  return <LiveClient initialData={data} error={error} getTranscript={getSessionTranscript} />;
}
