import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { buildEvidencePacket } from "../../lib/insights/evidence";
import { readTranscriptWindow } from "../../lib/live";
import { runAnalysisBenchmark } from "./analysis";
import {
  processMemorySnapshot,
  runtimeMetadata,
  summarizeDurationSamples,
  type DurationSummary,
  type ProcessMemorySnapshot,
  type RuntimeMetadata,
} from "./benchmark-report";

const DEFAULT_WARMUPS = 3;
const DEFAULT_SAMPLES = 30;
const MAX_WARMUPS = 20;
const MAX_SAMPLES = 100;
const EVIDENCE_MAX_RECORDS = 128;
const EVIDENCE_MAX_BYTES = 64 * 1024;
const FIXTURE_TURNS = 400;

type Measurement = DurationSummary & {
  responseBytes: number;
  sourceBytes: number;
  responseUnit: "bytes";
  sourceUnit: "bytes";
  details: Record<string, number | boolean | string>;
};

export interface EvidenceBenchmarkOptions {
  warmups?: number;
  samples?: number;
  outputPath?: string;
}

export interface EvidenceBenchmarkReport {
  version: "evidence-benchmark.v1";
  generatedAt: string;
  workload: {
    id: "synthetic-evidence-loop-v1";
    sourceFormat: "codex-sessions";
    fixtureTurns: number;
    fixtureSourceBytes: number;
    analysisPopulationSessions: number;
    evidenceMaxRecords: number;
    evidenceMaxBytes: number;
    transcriptWindowCap: number;
  };
  samples: { warmups: number; measured: number };
  runtime: RuntimeMetadata;
  memory: {
    scope: "single benchmark process snapshots";
    before: ProcessMemorySnapshot;
    after: ProcessMemorySnapshot;
    deltaBytes: { rss: number; heapUsed: number; external: number };
  };
  measurements: {
    collectionAggregation: Measurement;
    boundedEvidenceExtraction: Measurement;
    transcriptInitialRead: Measurement;
    transcriptContinuationRead: Measurement;
  };
  unavailable: {
    browser: { longTasks: "unavailable in CLI benchmark"; navigation: "unavailable in CLI benchmark"; fps: "unavailable in CLI benchmark" };
    diskCacheColdness: "unmeasured";
    productionServerColdStart: "unavailable in CLI benchmark";
  };
  notes: string[];
}

export interface EvidenceBenchmarkResult {
  report: EvidenceBenchmarkReport;
  reportPath: string;
}

function boundedCount(value: number | undefined, fallback: number, label: string, max: number, minimum: number): number {
  const count = value ?? fallback;
  if (!Number.isInteger(count) || count < minimum || count > max) throw new Error(`${label} must be an integer between ${minimum} and ${max}`);
  return count;
}

function fixtureLines(): string {
  const lines = [JSON.stringify({
    timestamp: "2026-01-06T09:00:00.000Z",
    type: "session_meta",
    payload: { id: "benchmark-session", cwd: "/synthetic/project", originator: "benchmark", source: "fixture", cli_version: "benchmark" },
  })];
  for (let i = 0; i < FIXTURE_TURNS; i++) {
    const timestamp = new Date(Date.UTC(2026, 0, 6, 9, 0, 1 + i * 4)).toISOString();
    const callId = `bench-call-${i}`;
    lines.push(JSON.stringify({ timestamp, type: "event_msg", payload: { type: "user_message", message: `Synthetic request ${i}: inspect the bounded fixture.` } }));
    lines.push(JSON.stringify({ timestamp, type: "response_item", payload: { type: "function_call", call_id: callId, name: "shell", arguments: JSON.stringify({ command: "node --test" }) } }));
    lines.push(JSON.stringify({ timestamp, type: "response_item", payload: { type: "function_call_output", call_id: callId, output: JSON.stringify({ output: `fixture output ${i}`, metadata: { exit_code: i % 17 === 0 ? 1 : 0 } }) } }));
    lines.push(JSON.stringify({ timestamp, type: "event_msg", payload: { type: "agent_message", message: `Synthetic response ${i}: retained fixture evidence.` } }));
  }
  return `${lines.join("\n")}\n`;
}

function measure<T>(operation: () => T, warmups: number, samples: number, responseBytes: (value: T) => number, details: (value: T) => Record<string, number | boolean | string>): Measurement {
  for (let i = 0; i < warmups; i++) operation();
  const durations: number[] = [];
  let last: T | undefined;
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    last = operation();
    const duration = performance.now() - start;
    if (!Number.isFinite(duration) || duration < 0) throw new Error("benchmark produced an invalid duration");
    durations.push(duration);
  }
  if (last === undefined) throw new Error("benchmark produced no result");
  const summary = summarizeDurationSamples(durations);
  const bytes = responseBytes(last);
  if (!Number.isInteger(bytes) || bytes <= 0) throw new Error("benchmark produced an invalid response byte count");
  return { ...summary, responseBytes: bytes, sourceBytes: 0, responseUnit: "bytes", sourceUnit: "bytes", details: details(last) };
}

function withSourceBytes(measurement: Measurement, sourceBytes: number): Measurement {
  return { ...measurement, sourceBytes };
}

function writeFixture(): { directory: string; file: string; bytes: number } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-evidence-bench-"));
  const file = path.join(directory, "codex-session.jsonl");
  fs.writeFileSync(file, fixtureLines(), "utf8");
  const bytes = fs.statSync(file).size;
  if (bytes <= EVIDENCE_MAX_BYTES) throw new Error("benchmark fixture did not exceed the evidence byte bound");
  return { directory, file, bytes };
}

function delta(before: ProcessMemorySnapshot, after: ProcessMemorySnapshot): { rss: number; heapUsed: number; external: number } {
  return {
    rss: after.rssBytes - before.rssBytes,
    heapUsed: after.heapUsedBytes - before.heapUsedBytes,
    external: after.externalBytes - before.externalBytes,
  };
}

function defaultOutputPath(): string {
  const configured = process.env.OPENEVAL_BENCH_REPORT_PATH;
  if (configured) return path.resolve(configured);
  return path.join(process.cwd(), ".test-data", "bench", `evidence-benchmark-${Date.now()}.json`);
}

export function runEvidenceBenchmark(options: EvidenceBenchmarkOptions = {}): EvidenceBenchmarkResult {
  const warmups = boundedCount(options.warmups, DEFAULT_WARMUPS, "warmups", MAX_WARMUPS, 0);
  const samples = boundedCount(options.samples, DEFAULT_SAMPLES, "samples", MAX_SAMPLES, 1);
  const fixture = writeFixture();
  const before = processMemorySnapshot();
  try {
    const analysis = runAnalysisBenchmark({ warmups, samples });
    const analysisMeasurement: Measurement = {
      ...summarizeDurationSamples(analysis.durationsMs),
      responseBytes: analysis.responseBytes,
      sourceBytes: 0,
      responseUnit: "bytes",
      sourceUnit: "bytes",
      details: { populationSessions: analysis.workload.populationSessions, sourceBytes: "not applicable to in-memory synthetic population" },
    };
    const packetMeasurement = withSourceBytes(measure(
      () => buildEvidencePacket(fixture.file, {
        sourceId: "synthetic-benchmark-source",
        sessionId: "benchmark-session",
        format: "codex-sessions",
        maxRecords: EVIDENCE_MAX_RECORDS,
        maxBytes: EVIDENCE_MAX_BYTES,
        excerptChars: 200,
      }),
      warmups,
      samples,
      (packet) => Buffer.byteLength(JSON.stringify(packet)),
      (packet) => ({ recordsRetained: packet.records.length, sourceRecordsObserved: packet.bounds.sourceRecords, bytesRead: packet.bounds.bytesRead, truncated: packet.bounds.truncated }),
    ), fixture.bytes);
    const initialMeasurement = withSourceBytes(measure(
      () => readTranscriptWindow(fixture.file, "codex-sessions", {}),
      warmups,
      samples,
      (result) => Buffer.byteLength(JSON.stringify(result)),
      (result) => ({ turns: result.turns.length, done: result.done, nextByteOffset: result.nextByteOffset }),
    ), fixture.bytes);
    const initial = readTranscriptWindow(fixture.file, "codex-sessions", {});
    if (initial.done || !initial.nextState) throw new Error("benchmark fixture did not expose a continuation cursor");
    const continuationMeasurement = withSourceBytes(measure(
      () => readTranscriptWindow(fixture.file, "codex-sessions", { byteOffset: initial.nextByteOffset, state: initial.nextState }),
      warmups,
      samples,
      (result) => Buffer.byteLength(JSON.stringify(result)),
      (result) => ({ turns: result.turns.length, done: result.done, offset: result.offset, nextByteOffset: result.nextByteOffset }),
    ), fixture.bytes);
    const after = processMemorySnapshot();
    const report: EvidenceBenchmarkReport = {
      version: "evidence-benchmark.v1",
      generatedAt: new Date().toISOString(),
      workload: {
        id: "synthetic-evidence-loop-v1",
        sourceFormat: "codex-sessions",
        fixtureTurns: FIXTURE_TURNS,
        fixtureSourceBytes: fixture.bytes,
        analysisPopulationSessions: analysis.workload.populationSessions,
        evidenceMaxRecords: EVIDENCE_MAX_RECORDS,
        evidenceMaxBytes: EVIDENCE_MAX_BYTES,
        transcriptWindowCap: 240,
      },
      samples: { warmups, measured: samples },
      runtime: runtimeMetadata(),
      memory: { scope: "single benchmark process snapshots", before, after, deltaBytes: delta(before, after) },
      measurements: {
        collectionAggregation: analysisMeasurement,
        boundedEvidenceExtraction: packetMeasurement,
        transcriptInitialRead: initialMeasurement,
        transcriptContinuationRead: continuationMeasurement,
      },
      unavailable: {
        browser: { longTasks: "unavailable in CLI benchmark", navigation: "unavailable in CLI benchmark", fps: "unavailable in CLI benchmark" },
        diskCacheColdness: "unmeasured",
        productionServerColdStart: "unavailable in CLI benchmark",
      },
      notes: [
        "Synthetic fixture and in-memory aggregation only; no providers, real source inventory, or real data-root cache writes.",
        "Source and response byte counts are measured from the fixture file and serialized return values; zero sourceBytes denotes an in-memory workload with no source file.",
        "Measurements describe one fixed workload and do not claim a speedup or production latency improvement.",
      ],
    };
    const reportPath = path.resolve(options.outputPath ?? defaultOutputPath());
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return { report, reportPath };
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/perf/evidence-bench.ts")) {
  try {
    const result = runEvidenceBenchmark();
    console.log(JSON.stringify({
      reportPath: path.relative(process.cwd(), result.reportPath),
      workload: result.report.workload,
      samples: result.report.samples,
      measurements: result.report.measurements,
      unavailable: result.report.unavailable,
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
