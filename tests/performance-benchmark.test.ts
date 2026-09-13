import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { nearestRank, summarizeDurationSamples } from "../scripts/perf/benchmark-report";
import { runEvidenceBenchmark } from "../scripts/perf/evidence-bench";

test("duration summaries use bounded nearest-rank percentiles", () => {
  assert.equal(nearestRank([4, 1, 3, 2], 0.5), 2);
  assert.equal(nearestRank([4, 1, 3, 2], 0.95), 4);
  assert.deepEqual(summarizeDurationSamples([1, 2, 3]), {
    unit: "ms",
    sampleCount: 3,
    median: 2,
    p95: 3,
    min: 1,
    max: 3,
    quantiles: { median: 0.5, p95: 0.95, method: "nearest-rank" },
  });
  assert.throws(() => nearestRank([], 0.5), /empty sample/);
  assert.throws(() => nearestRank([1], 0), /quantile/);
});

test("evidence benchmark reports bounded synthetic measurements", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-benchmark-test-"));
  const outputPath = path.join(directory, "report.json");
  try {
    const result = runEvidenceBenchmark({ warmups: 1, samples: 3, outputPath });
    assert.equal(result.report.version, "evidence-benchmark.v1");
    assert.equal(result.report.samples.measured, 3);
    assert.equal(result.report.samples.warmups, 1);
    assert.ok(result.report.workload.fixtureSourceBytes > result.report.workload.evidenceMaxBytes);
    assert.equal(result.report.measurements.collectionAggregation.sampleCount, 3);
    assert.ok(result.report.measurements.boundedEvidenceExtraction.responseBytes > 0);
    assert.ok(typeof result.report.measurements.boundedEvidenceExtraction.details.recordsRetained === "number");
    assert.ok(typeof result.report.measurements.transcriptInitialRead.details.turns === "number");
    assert.ok(typeof result.report.measurements.transcriptContinuationRead.details.turns === "number");
    assert.ok(result.report.measurements.boundedEvidenceExtraction.details.recordsRetained <= result.report.workload.evidenceMaxRecords);
    assert.ok(result.report.measurements.transcriptInitialRead.details.turns > 0);
    assert.ok(result.report.measurements.transcriptContinuationRead.details.turns > 0);
    assert.equal(result.report.unavailable.browser.fps, "unavailable in CLI benchmark");
    assert.equal(result.report.unavailable.diskCacheColdness, "unmeasured");
    assert.equal(fs.existsSync(outputPath), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, "utf8")).workload, result.report.workload);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("benchmark scripts are guarded and do not run on import", () => {
  const evidenceSource = fs.readFileSync(path.join(process.cwd(), "scripts/perf/evidence-bench.ts"), "utf8");
  const analysisSource = fs.readFileSync(path.join(process.cwd(), "scripts/perf/analysis.ts"), "utf8");
  const liveSource = fs.readFileSync(path.join(process.cwd(), "scripts/bench-live.ts"), "utf8");
  assert.match(evidenceSource, /process\.argv\[1\].*scripts\/perf\/evidence-bench\.ts/s);
  assert.match(analysisSource, /process\.argv\[1\].*scripts\/perf\/analysis\.ts/s);
  assert.match(liveSource, /process\.argv\[1\].*scripts\/bench-live\.ts/s);
  assert.doesNotMatch(liveSource, /\nmain\(\);\s*$/);
});
