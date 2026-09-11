import { NextResponse } from "next/server";
import { countRuns, getRunCaseSummariesBatch, listRuns, type RunCaseSummary } from "@/lib/db";
import { internalError } from "@/lib/api-http";

export const dynamic = "force-dynamic";

const LEADERBOARD_RUN_LIMIT = 200;

type MetricEvidenceSource = "measured" | "inferred" | "unspecified" | "missing";

interface MetricCoverage {
  total: number;
  available: number;
  missing: number;
  measured: number;
  inferred: number;
  unspecified: number;
  zero: number;
  sum: number;
}

interface WorkloadCategory {
  category: string;
  cases: number;
  uniqueCaseIds: number;
  samples: number;
  passed: number;
  failed: number;
  errored: number;
}

interface WorkloadCase {
  caseId: string;
  cases: number;
  samples: number;
}

interface WorkloadModel {
  model: string;
  cases: number;
  runs: number;
}

interface WorkloadRunReference {
  id: string;
  name: string;
  createdAt: number;
  status: string;
  caseCount: number;
  model: string | null;
}

interface HarnessWorkload {
  categories: WorkloadCategory[];
  caseIds: WorkloadCase[];
  samples: number[];
  models: WorkloadModel[];
  runReferences: WorkloadRunReference[];
  uniqueCaseIds: number;
  sampleCount: number;
  modelCount: number;
  mixed: boolean;
}

interface HarnessAggregate {
  harness: string;
  runCount: number;
  totalCases: number;
  passed: number;
  failed: number;
  errored: number;
  passRate: number;
  totalCostUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalDurationMs: number;
  avgTokPerSec: number;
  model?: string;
  latestRunAt: number | null;
  costCoverage: MetricCoverage;
  durationCoverage: MetricCoverage;
  workload: HarnessWorkload;
}

interface LeaderboardScope {
  latestRuns: number;
  totalRuns: number;
  runLimit: number;
  truncated: boolean;
  description: string;
}

interface LeaderboardResponse {
  harnesses: HarnessAggregate[];
  scope: LeaderboardScope;
}

interface MutableCategory {
  category: string;
  cases: number;
  caseIds: Set<string>;
  samples: Set<number>;
  passed: number;
  failed: number;
  errored: number;
}

interface MutableCase {
  caseId: string;
  cases: number;
  samples: Set<number>;
}

interface MutableModel {
  model: string;
  cases: number;
  runs: number;
}

interface MutableWorkload {
  categories: Map<string, MutableCategory>;
  caseIds: Map<string, MutableCase>;
  samples: Set<number>;
  models: Map<string, MutableModel>;
  runReferences: WorkloadRunReference[];
}

interface MutableAggregate {
  harness: string;
  runCount: number;
  totalCases: number;
  passed: number;
  failed: number;
  errored: number;
  totalCostUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalDurationMs: number;
  model?: string;
  latestRunAt: number | null;
  costCoverage: MetricCoverage;
  durationCoverage: MetricCoverage;
  workload: MutableWorkload;
}

function emptyCoverage(): MetricCoverage {
  return { total: 0, available: 0, missing: 0, measured: 0, inferred: 0, unspecified: 0, zero: 0, sum: 0 };
}

function addCoverage(coverage: MetricCoverage, value: number | null, source: MetricEvidenceSource): void {
  coverage.total += 1;
  if (source === "missing" || value === null || !Number.isFinite(value)) {
    coverage.missing += 1;
    return;
  }
  coverage.available += 1;
  coverage[source] += 1;
  if (value === 0) coverage.zero += 1;
  coverage.sum += value;
}

function emptyWorkload(): MutableWorkload {
  return { categories: new Map(), caseIds: new Map(), samples: new Set(), models: new Map(), runReferences: [] };
}

function emptyAggregate(harness: string): MutableAggregate {
  return {
    harness,
    runCount: 0,
    totalCases: 0,
    passed: 0,
    failed: 0,
    errored: 0,
    totalCostUsd: 0,
    totalTokensIn: 0,
    totalTokensOut: 0,
    totalDurationMs: 0,
    latestRunAt: null,
    costCoverage: emptyCoverage(),
    durationCoverage: emptyCoverage(),
    workload: emptyWorkload(),
  };
}

function modelKey(model: string | null | undefined): string {
  return model?.trim() || "unspecified";
}

function addModel(workload: MutableWorkload, model: string | null | undefined, cases: number, run = true): void {
  const key = modelKey(model);
  const entry = workload.models.get(key) ?? { model: key, cases: 0, runs: 0 };
  entry.cases += cases;
  if (run) entry.runs += 1;
  workload.models.set(key, entry);
}

function addCaseMetadata(workload: MutableWorkload, summary: RunCaseSummary): void {
  const categoryKey = summary.category ?? "unspecified";
  const category = workload.categories.get(categoryKey) ?? {
    category: categoryKey,
    cases: 0,
    caseIds: new Set<string>(),
    samples: new Set<number>(),
    passed: 0,
    failed: 0,
    errored: 0,
  };
  category.cases += 1;
  category.caseIds.add(summary.case_id);
  category.samples.add(summary.sample);
  if (summary.status === "passed") category.passed += 1;
  if (summary.status === "failed") category.failed += 1;
  if (summary.status === "error") category.errored += 1;
  workload.categories.set(categoryKey, category);

  const caseId = workload.caseIds.get(summary.case_id) ?? { caseId: summary.case_id, cases: 0, samples: new Set<number>() };
  caseId.cases += 1;
  caseId.samples.add(summary.sample);
  workload.caseIds.set(summary.case_id, caseId);
  workload.samples.add(summary.sample);
  addModel(workload, summary.model, 1, false);
}

function finalizeWorkload(workload: MutableWorkload): HarnessWorkload {
  const categories = [...workload.categories.values()]
    .sort((a, b) => b.cases - a.cases || a.category.localeCompare(b.category))
    .map((entry) => ({
      category: entry.category,
      cases: entry.cases,
      uniqueCaseIds: entry.caseIds.size,
      samples: entry.samples.size,
      passed: entry.passed,
      failed: entry.failed,
      errored: entry.errored,
    }));
  const caseIds = [...workload.caseIds.values()]
    .sort((a, b) => b.cases - a.cases || a.caseId.localeCompare(b.caseId))
    .map((entry) => ({ caseId: entry.caseId, cases: entry.cases, samples: entry.samples.size }));
  const models = [...workload.models.values()]
    .sort((a, b) => b.cases - a.cases || a.model.localeCompare(b.model));
  const samples = [...workload.samples].sort((a, b) => a - b);
  const mixed = categories.length > 1 || caseIds.length > 1 || models.length > 1 || samples.length > 1;
  return {
    categories,
    caseIds,
    samples,
    models,
    runReferences: [...workload.runReferences].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)),
    uniqueCaseIds: caseIds.length,
    sampleCount: samples.length,
    modelCount: models.length,
    mixed,
  };
}

function finalizeAggregate(aggregate: MutableAggregate): HarnessAggregate {
  return {
    harness: aggregate.harness,
    runCount: aggregate.runCount,
    totalCases: aggregate.totalCases,
    passed: aggregate.passed,
    failed: aggregate.failed,
    errored: aggregate.errored,
    passRate: aggregate.totalCases > 0 ? aggregate.passed / aggregate.totalCases : 0,
    totalCostUsd: aggregate.totalCostUsd,
    totalTokensIn: aggregate.totalTokensIn,
    totalTokensOut: aggregate.totalTokensOut,
    totalDurationMs: aggregate.totalDurationMs,
    avgTokPerSec: aggregate.totalDurationMs > 0 ? aggregate.totalTokensOut / (aggregate.totalDurationMs / 1000) : 0,
    model: aggregate.model,
    latestRunAt: aggregate.latestRunAt,
    costCoverage: aggregate.costCoverage,
    durationCoverage: aggregate.durationCoverage,
    workload: finalizeWorkload(aggregate.workload),
  };
}

function aggregateByHarness(runs = listRuns(LEADERBOARD_RUN_LIMIT)): HarnessAggregate[] {
  const runIds = runs.map((run) => run.id);
  const caseSummaries = getRunCaseSummariesBatch(runIds);
  const byHarness = new Map<string, MutableAggregate>();

  for (const run of runs) {
    const harness = run.params.harness || "unknown";
    const cases = caseSummaries.get(run.id) ?? [];
    const completed = cases.filter((summary) => ["passed", "failed", "error"].includes(summary.status));
    const passed = cases.filter((summary) => summary.status === "passed").length;
    const failed = cases.filter((summary) => summary.status === "failed").length;
    const errored = cases.filter((summary) => summary.status === "error").length;
    const aggregate = byHarness.get(harness) ?? emptyAggregate(harness);
    aggregate.runCount += 1;
    aggregate.totalCases += completed.length;
    aggregate.passed += passed;
    aggregate.failed += failed;
    aggregate.errored += errored;
    aggregate.latestRunAt = Math.max(aggregate.latestRunAt ?? 0, run.created_at);
    if (!aggregate.model && run.params.model) aggregate.model = run.params.model;

    aggregate.workload.runReferences.push({
      id: run.id,
      name: run.name,
      createdAt: run.created_at,
      status: run.status,
      caseCount: cases.length,
      model: run.params.model ?? null,
    });
    addModel(aggregate.workload, run.params.model, 0, true);

    for (const summary of cases) {
      aggregate.totalCostUsd += summary.runner_cost_usd ?? 0;
      aggregate.totalTokensIn += summary.runner_input_tokens ?? 0;
      aggregate.totalTokensOut += summary.runner_output_tokens ?? 0;
      aggregate.totalDurationMs += summary.runner_duration_ms ?? 0;
      addCoverage(aggregate.costCoverage, summary.runner_cost_usd, summary.runner_cost_source);
      addCoverage(aggregate.durationCoverage, summary.runner_duration_ms, summary.runner_duration_source);
      addCaseMetadata(aggregate.workload, summary);
    }
    byHarness.set(harness, aggregate);
  }

  return [...byHarness.values()]
    .map(finalizeAggregate)
    .sort((a, b) => b.passRate - a.passRate || b.runCount - a.runCount || a.harness.localeCompare(b.harness));
}

function leaderboardScope(runs = listRuns(LEADERBOARD_RUN_LIMIT)): LeaderboardScope {
  const totalRuns = countRuns();
  return {
    latestRuns: runs.length,
    totalRuns,
    runLimit: LEADERBOARD_RUN_LIMIT,
    truncated: totalRuns > runs.length,
    description: `Aggregates ${runs.length} retained runs (latest ${LEADERBOARD_RUN_LIMIT} maximum) by creation time; the full database contains ${totalRuns} run${totalRuns === 1 ? "" : "s"}.`,
  };
}

function buildLeaderboardResponse(): LeaderboardResponse {
  const runs = listRuns(LEADERBOARD_RUN_LIMIT);
  return { harnesses: aggregateByHarness(runs), scope: leaderboardScope(runs) };
}

export async function GET() {
  try {
    return NextResponse.json(buildLeaderboardResponse(), {
      headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=120" },
    });
  } catch (error) {
    return internalError("Failed to build harness leaderboard", error);
  }
}
