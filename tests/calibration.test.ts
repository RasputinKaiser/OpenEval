import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-calibration-"));
process.env.OPENEVAL_DATA_ROOT = root;

let calibration: typeof import("../lib/calibration");
let db: ReturnType<typeof import("../lib/db").getDb>;

test.before(async () => {
  calibration = await import("../lib/calibration");
  const dbmod = await import("../lib/db");
  db = dbmod.getDb();
});

const identity = {
  sourceId: "codex",
  sessionId: "session-1",
  evidenceDigest: "digest-1",
  evidenceVersion: "evidence-packet.v1",
  rubric: "goal-rubric-v1",
};

function reference(overrides: Record<string, unknown> = {}) {
  return {
    referenceId: "ref-1",
    label: "Synthetic fixture reference",
    authorLabel: "fixture author",
    provenance: "synthetic" as const,
    ...identity,
    outcome: "achieved" as const,
    rationale: "The fixture contains a matching observed receipt.",
    citedEvidenceIds: ["e-1"],
    ...overrides,
  };
}

function observation(recordId: string, overrides: Record<string, unknown> = {}) {
  return {
    recordId,
    referenceId: "ref-human",
    referenceVersion: 1,
    provenance: "imported" as const,
    ...identity,
    outcome: "achieved" as const,
    citedEvidenceIds: ["e-1"],
    evidenceInventoryIds: ["e-1", "e-2"],
    backend: "local",
    model: "fixture-model",
    reasoningEffort: "none",
    promptVersion: 1,
    costUsd: 0.25,
    elapsedMs: 120,
    createdAt: Number(recordId.replace(/\D/g, "")) || 1,
    ...overrides,
  };
}

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test("references are explicit, append-only versions and human authorship is attested", () => {
  assert.throws(() => calibration.createCalibrationReference(reference({ provenance: "human" }), db), /attestation/i);
  const first = calibration.createCalibrationReference(reference({ referenceId: "versioned", provenance: "synthetic" }), db);
  const second = calibration.createCalibrationReference(reference({ referenceId: "versioned", label: "Second version", provenance: "synthetic" }), db);
  assert.equal(first.version, 1);
  assert.equal(second.version, 2);
  assert.equal(calibration.listCalibrationReferences(db).filter((item) => item.referenceId === "versioned").length, 2);
  const human = calibration.createCalibrationReference(reference({ referenceId: "ref-human", provenance: "human", humanAttestation: true, authorLabel: "operator", outcome: "not_achieved" }), db);
  assert.equal(human.provenance, "human");
});

test("imports are strict, atomic, and idempotent", () => {
  const imported = calibration.importCalibrationObservations([observation("obs-1")], db);
  assert.deepEqual(imported, { inserted: 1, unchanged: 0 });
  assert.deepEqual(calibration.importCalibrationObservations([observation("obs-1")], db), { inserted: 0, unchanged: 1 });
  assert.throws(() => calibration.importCalibrationObservations([observation("obs-atomic"), observation("obs-1", { outcome: "partial" })], db), /different payload/);
  assert.equal(calibration.listCalibrationObservations(db).some((item) => item.recordId === "obs-atomic"), false, "failed batches must not partially persist");
  assert.throws(() => calibration.importCalibrationObservations([observation("obs-bad", { provenance: "human" })], db), /provenance/i);
});

test("report keeps human and synthetic denominators separate and exposes missing proof", () => {
  calibration.createCalibrationReference(reference({ referenceId: "ref-synthetic", provenance: "synthetic" }), db);
  calibration.createCalibrationReference(reference({ referenceId: "ref-imported", provenance: "imported" }), db);
  calibration.importCalibrationObservations([
    observation("obs-human-a", { model: "report-model", referenceId: "ref-human", outcome: "achieved", createdAt: 10 }),
    observation("obs-human-b", { model: "report-model", referenceId: "ref-human", outcome: "achieved", createdAt: 11, citedEvidenceIds: ["missing"], evidenceInventoryIds: null }),
    observation("obs-synthetic", { model: "report-model", referenceId: "ref-synthetic", outcome: "achieved", createdAt: 12 }),
    observation("obs-imported-reference", { model: "imported-model", referenceId: "ref-imported", outcome: "achieved", createdAt: 13 }),
  ], db);
  const method = calibration.buildCalibrationReport(db).methods.find((item) => item.model === "report-model");
  assert.ok(method);
  assert.equal(method!.humanMatchedJudgments, 2);
  assert.equal(method!.syntheticMatchedJudgments, 1);
  assert.equal(method!.agreementDenominator, 2);
  assert.equal(method!.agreementNumerator, 0);
  assert.equal(method!.falseSuccessDenominator, 2);
  assert.equal(method!.falseSuccessNumerator, 2);
  assert.equal(method!.abstentionDenominator, 2);
  assert.equal(method!.citationUnknownJudgments, 1);
  assert.equal(method!.repeatabilityPairs, 1);
  assert.equal(method!.repeatabilityStablePairs, 1);
  assert.equal(method!.costUsdCount, 3);
  assert.equal(method!.elapsedMsCount, 3);
  const importedMethod = calibration.buildCalibrationReport(db).methods.find((item) => item.model === "imported-model");
  assert.ok(importedMethod);
  assert.equal(importedMethod!.humanMatchedJudgments, 0);
  assert.equal(importedMethod!.syntheticMatchedJudgments, 0);
  assert.equal(importedMethod!.importedMatchedJudgments, 1);
});
