import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "openeval-calibration-route-"));
process.env.OPENEVAL_DATA_ROOT = root;
let route: typeof import("../app/api/calibration/route");

test.before(async () => {
  route = await import("../app/api/calibration/route");
});

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test("calibration route rejects malformed JSON and invalid actions", async () => {
  const malformed = await route.POST(new Request("http://localhost/api/calibration", { method: "POST", body: "{" }));
  assert.equal(malformed.status, 400);
  const action = await route.POST(new Request("http://localhost/api/calibration", { method: "POST", body: JSON.stringify({ action: "run_provider" }) }));
  assert.equal(action.status, 400);
});

test("calibration route creates references, imports observations, and reports", async () => {
  const reference = {
    referenceId: "route-ref",
    label: "Route fixture",
    authorLabel: "fixture",
    provenance: "synthetic",
    sourceId: "codex",
    sessionId: "route-session",
    evidenceDigest: "route-digest",
    evidenceVersion: "evidence-packet.v1",
    rubric: "route-rubric",
    outcome: "achieved",
    rationale: "fixture",
    citedEvidenceIds: ["e-1"],
  };
  const created = await route.POST(new Request("http://localhost/api/calibration", { method: "POST", body: JSON.stringify({ action: "create_reference", reference }) }));
  assert.equal(created.status, 201);
  const imported = await route.POST(new Request("http://localhost/api/calibration", { method: "POST", body: JSON.stringify({ action: "import_observations", observations: [{ recordId: "route-observation", referenceId: "route-ref", referenceVersion: 1, provenance: "synthetic", sourceId: "codex", sessionId: "route-session", evidenceDigest: "route-digest", evidenceVersion: "evidence-packet.v1", rubric: "route-rubric", outcome: "achieved", citedEvidenceIds: ["e-1"], evidenceInventoryIds: ["e-1"], backend: "fixture", model: "model", reasoningEffort: "none", promptVersion: 1 }] }) }));
  assert.equal(imported.status, 200);
  const report = await route.GET(new Request("http://localhost/api/calibration?view=report"));
  assert.equal(report.status, 200);
  const body = await report.json();
  assert.equal(body.observations.matched, 1);
  assert.equal(body.references.synthetic, 1);
});
