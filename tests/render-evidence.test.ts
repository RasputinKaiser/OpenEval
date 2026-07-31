import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CaseDefinitionSchema } from "../lib/cases";
import { runGrader } from "../lib/grader";
import {
  validateRenderEvidence,
  type RenderEvidenceReceipt,
  type RenderEvidenceExpectation,
} from "../lib/render-evidence";
import type { GraderSpec, RunnerResult } from "../lib/types";

const ROOT = path.join(__dirname, "..");
const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}</style></head><body><main data-testid="eval-dashboard">OpenEval</main></body></html>`;

function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function receiptFor(artifactPath: string, artifactKind: "html" | "svg", artifactText: string): RenderEvidenceReceipt {
  return {
    version: 1,
    artifact: { path: artifactPath, kind: artifactKind, sha256: digest(artifactText) },
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    runtime: {
      loaded: true,
      consoleErrors: [],
      horizontalOverflow: false,
      clientWidth: 1280,
      scrollWidth: 1280,
      selectors: [{ selector: '[data-testid="eval-dashboard"]', count: 1, visible: true }],
    },
  };
}

const EXPECTATION: RenderEvidenceExpectation = {
  artifactPath: "index.html",
  artifactKind: "html",
  viewport: { width: 1280, height: 720 },
  selectors: [{ selector: '[data-testid="eval-dashboard"]', minCount: 1, visible: true }],
};

async function withWorkdir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "render-evidence-test-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("self-contained HTML receipt passes fixed runtime checks without a pixel claim", () => {
  const result = validateRenderEvidence({
    artifactText: HTML,
    receipt: receiptFor("index.html", "html", HTML),
    expectation: EXPECTATION,
  });

  assert.equal(result.status, "pass");
  assert.equal(result.claims.browserCapture, "receipt_validated_not_attested");
  assert.equal(result.claims.pixelQuality, "not_evaluated");
  assert.equal(result.checks.some((check) => !check.passed), false);
});

test("runtime mismatches and external resources fail instead of becoming visual claims", () => {
  const artifact = HTML.replace("</main>", "<img src=\"https://example.com/pixel.png\"></main>");
  const receipt = receiptFor("index.html", "html", artifact);
  receipt.viewport.width = 390;
  receipt.runtime.consoleErrors = ["ReferenceError: broken is not defined"];
  receipt.runtime.horizontalOverflow = true;
  receipt.runtime.clientWidth = 390;
  receipt.runtime.scrollWidth = 600;
  receipt.runtime.selectors[0].count = 0;

  const result = validateRenderEvidence({ artifactText: artifact, receipt, expectation: EXPECTATION });
  assert.equal(result.status, "fail");
  assert.match(result.checks.find((check) => check.id === "artifact_static")?.detail ?? "", /external|relative/i);
  assert.equal(result.checks.find((check) => check.id === "viewport")?.passed, false);
  assert.equal(result.checks.find((check) => check.id === "console_errors")?.passed, false);
  assert.equal(result.checks.find((check) => check.id === "horizontal_overflow")?.passed, false);
  assert.equal(result.checks.find((check) => check.id.startsWith("selector:"))?.passed, false);
  assert.equal(result.claims.pixelQuality, "not_evaluated");
});

test("malformed or absent receipts are explicitly blocked", () => {
  const result = validateRenderEvidence({ artifactText: HTML, receipt: { version: 1 }, expectation: EXPECTATION });
  assert.equal(result.status, "blocked");
  assert.equal(result.observed, null);
  assert.equal(result.checks.find((check) => check.id === "receipt_schema")?.passed, false);
  assert.equal(result.claims.pixelQuality, "not_evaluated");
});

test("SVG artifacts use the same receipt contract", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect width="20" height="20" fill="red"/></svg>';
  const result = validateRenderEvidence({
    artifactText: svg,
    receipt: receiptFor("card.svg", "svg", svg),
    expectation: {
      artifactPath: "card.svg",
      artifactKind: "svg",
      viewport: { width: 1280, height: 720 },
    },
  });
  assert.equal(result.status, "pass");
  assert.equal(result.artifact.kind, "svg");
});

test("render_evidence is strict in the case schema and wired to the grader", async () => {
  const spec: Extract<GraderSpec, { type: "render_evidence" }> = {
    type: "render_evidence",
    artifact_path: "index.html",
    receipt_path: "evidence/render.json",
    artifact_kind: "html",
    viewport: { width: 1280, height: 720 },
    selectors: [{ selector: '[data-testid="eval-dashboard"]', min_count: 1, visible: true }],
  };
  const baseCase = {
    id: "render-receipt",
    category: "visual-code",
    name: "Render receipt",
    prompt: "create a page",
    graders: [spec],
  };
  assert.equal(CaseDefinitionSchema.safeParse(baseCase).success, true);
  assert.equal(CaseDefinitionSchema.safeParse({ ...baseCase, graders: [{ ...spec, unexpected: true }] }).success, false);

  await withWorkdir(async (dir) => {
    await fs.mkdir(path.join(dir, "evidence"));
    await fs.writeFile(path.join(dir, "index.html"), HTML);
    await fs.writeFile(path.join(dir, "evidence/render.json"), JSON.stringify(receiptFor("index.html", "html", HTML)));
    const result = await runGrader(spec, {
      workdir: dir,
      runner: { toolCalls: [] } as unknown as RunnerResult,
      transcriptText: "",
    });
    assert.equal(result.passed, true);
    assert.equal(result.evidenceTier, "deterministic");
    assert.match(result.output ?? "", /pixelQuality/);
    assert.match(result.output ?? "", /not_evaluated/);
  });
});

test("render:evidence CLI emits a machine-readable status", async () => {
  await withWorkdir(async (dir) => {
    const artifactPath = path.join(dir, "index.html");
    const receiptPath = path.join(dir, "receipt.json");
    await fs.writeFile(artifactPath, HTML);
    await fs.writeFile(receiptPath, JSON.stringify(receiptFor(artifactPath, "html", HTML)));
    const run = spawnSync(process.execPath, [
      "--import", "tsx", path.join(ROOT, "scripts/render-evidence.ts"),
      "--artifact", artifactPath,
      "--receipt", receiptPath,
      "--viewport", "1280x720",
      "--selector", '[data-testid="eval-dashboard"]',
    ], { cwd: ROOT, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout) as { status?: string; claims?: { pixelQuality?: string } };
    assert.equal(result.status, "pass");
    assert.equal(result.claims?.pixelQuality, "not_evaluated");
  });
});
