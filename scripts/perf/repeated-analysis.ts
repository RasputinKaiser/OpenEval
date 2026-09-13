import { performance } from "node:perf_hooks";
import type { CollectedSession } from "../../lib/collection/aggregate";
import { createAnalysisReader } from "../../lib/collection/analysis-cache";

const POPULATION_SIZE = 12_000;
const DEFAULT_WARMUPS = 3;
const DEFAULT_SAMPLES = 60;
const MAX_WARMUPS = 100;
const MAX_SAMPLES = 100;

function session(overrides: Partial<CollectedSession> = {}): CollectedSession {
  const base: CollectedSession = {
    sessionId: "same-session",
    sourceId: "source-a",
    sourceLabel: "Source A",
    displayTitle: "private title",
    lastPromptPreview: "private prompt",
    project: "/private/project",
    model: "gpt-5.6-luna",
    startedAt: Date.parse("2026-01-05T12:00:00.000Z"),
    lastEventAt: Date.parse("2026-01-05T12:01:00.000Z"),
    durationMs: 120_000,
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    totalTokens: 150,
    costUsd: 0.25,
    usageSegments: [],
    toolCalls: 4,
    toolErrors: 1,
    numTurns: 1,
    stopReason: null,
    isError: false,
    pathBytes: 1,
    lineCount: 1,
    malformedLineCount: 0,
    thinkingBlocks: 0,
    textBlocks: 1,
    attachmentCount: 0,
    queueOperationCount: 0,
    snapshotCount: 0,
    hookErrors: 0,
    messageCount: 1,
    userType: null,
    dataQuality: 1,
    metricSources: { model: "measured", tokens: "measured", cost: "measured", duration: "measured", turns: "measured" },
    parseWarnings: [],
    toolErrorRate: 0.25,
    toolCallsPerTurn: 4,
    textAvailability: 1,
    staleMs: 0,
    traceGraph: { rootMessages: 1, sidechainMessages: 0, agentCount: 0, orphanMessages: 0 },
    toolSummaries: [{ name: "Read", calls: 3, errors: 1 }, { name: "Write", calls: 1, errors: 0 }],
    toolDurations: [],
    queueSummary: { enqueue: 0, dequeue: 0, remove: 0, popAll: 0, preview: [] },
    fileActivity: { touchedFiles: [], readLikeOperations: 0, writeLikeOperations: 0 },
    modeSummary: { permissionModes: {}, gitBranch: null, entrypoint: null },
    skillsUsed: [],
    mcpServersUsed: [],
    subagentSpawns: 0,
    cliVersion: null,
    outcomeSignals: { userPositive: 1, userNegative: 0, rephrases: 0, errorTail: false, testsPassedTail: true, reworkFiles: 0 },
  };
  return { ...base, ...overrides, metricSources: { ...base.metricSources, ...(overrides.metricSources ?? {}) } };
}

const population = Array.from({ length: POPULATION_SIZE }, (_, i) => session({
  sessionId: String(i),
  startedAt: Date.UTC(2025, 0, 1) + i * 2_160_000,
  model: i % 2 ? "model-a" : "model-b",
}));

export interface AnalysisBenchmarkOptions {
  warmups?: number;
  samples?: number;
}

export interface AnalysisBenchmarkResult {
  workload: {
    id: "synthetic-repeated-analysis-v1";
    populationSessions: number;
    selectionPattern: "alternate-all-and-model-a";
  };
  warmups: number;
  samples: number;
  durationsMs: number[];
  responseBytes: number;
}

function boundedCount(value: number | undefined, fallback: number, label: string, max: number, minimum: number): number {
  const count = value ?? fallback;
  if (!Number.isInteger(count) || count < minimum || count > max) {
    throw new Error(`${label} must be an integer between ${minimum} and ${max}`);
  }
  return count;
}

export function runAnalysisBenchmark(options: AnalysisBenchmarkOptions = {}): AnalysisBenchmarkResult {
  const warmups = boundedCount(options.warmups, DEFAULT_WARMUPS, "warmups", MAX_WARMUPS, 0);
  const samples = boundedCount(options.samples, DEFAULT_SAMPLES, "samples", MAX_SAMPLES, 1);
  const durationsMs: number[] = [];
  let responseBytes = 0;
  const read = createAnalysisReader();
  const measure = (iteration: number): number => {
    const start = performance.now();
    const report = read(population, iteration % 2 ? { model: "model-a" } : {}, { generatedAtMs: 1 }, { offset: 0, limit: 80 });
    const duration = performance.now() - start;
    if (!Number.isFinite(duration) || duration < 0) throw new Error("analysis benchmark produced an invalid duration");
    responseBytes = Buffer.byteLength(JSON.stringify(report));
    return duration;
  };
  for (let i = 0; i < warmups; i++) measure(i);
  for (let i = 0; i < samples; i++) durationsMs.push(measure(i));
  return {
    workload: { id: "synthetic-repeated-analysis-v1", populationSessions: POPULATION_SIZE, selectionPattern: "alternate-all-and-model-a" },
    warmups,
    samples,
    durationsMs,
    responseBytes,
  };
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/perf/repeated-analysis.ts")) {
  console.log(JSON.stringify(runAnalysisBenchmark()));
}
