import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { auditCase, auditCases } from "../lib/accuracy";
import { loadCases } from "../lib/cases";
import { REPO_ROOT } from "../lib/config";
import type { CaseDefinition, GraderSpec } from "../lib/types";

function makeCase(overrides: Partial<CaseDefinition> = {}): CaseDefinition {
  return {
    id: "synthetic",
    category: "single-tool",
    name: "Synthetic",
    prompt: "do a thing",
    graders: [{ type: "exit_code", command: "true" }] as GraderSpec[],
    ...overrides,
  };
}

// A fileExists that only knows about paths we explicitly register as present.
function existsOnly(present: string[]): (p: string) => boolean {
  const set = new Set(present.map((p) => path.normalize(p)));
  return (p: string) => set.has(path.normalize(p));
}

test("oracle-file existence: fires on a dangling solve script", () => {
  const c = makeCase({ oracle: { solve: "oracle/does-not-exist.sh" } });
  const row = auditCase(c, { casesDir: "/tmp/synthetic-cases", fileExists: () => false });
  assert.ok(
    row.weaknesses.some((w) => w.startsWith("oracle script missing on disk: oracle/does-not-exist.sh")),
    `expected missing-script weakness, got: ${JSON.stringify(row.weaknesses)}`,
  );
});

test("oracle-file existence: fires on a dangling known_bad script but not the present solve", () => {
  const casesDir = "/tmp/synthetic-cases";
  const solveAbs = path.join(casesDir, "single-tool", "oracle/solve.sh");
  const c = makeCase({
    oracle: { solve: "oracle/solve.sh", known_bad: ["oracle/bad-missing.sh"] },
  });
  const row = auditCase(c, { casesDir, fileExists: existsOnly([solveAbs]) });
  const missing = row.weaknesses.filter((w) => w.startsWith("oracle script missing on disk"));
  assert.equal(missing.length, 1, `exactly the missing known_bad should flag, got: ${JSON.stringify(missing)}`);
  assert.ok(missing[0].includes("oracle/bad-missing.sh"));
});

test("oracle-file existence: silent when all referenced scripts resolve", () => {
  const casesDir = "/tmp/synthetic-cases";
  const solveAbs = path.join(casesDir, "single-tool", "oracle/solve.sh");
  const badAbs = path.join(casesDir, "single-tool", "oracle/bad.sh");
  const c = makeCase({ oracle: { solve: "oracle/solve.sh", known_bad: ["oracle/bad.sh"] } });
  const row = auditCase(c, { casesDir, fileExists: existsOnly([solveAbs, badAbs]) });
  assert.equal(
    row.weaknesses.filter((w) => w.startsWith("oracle script missing on disk")).length,
    0,
  );
});

test("no-op baseline heuristic: fires when all deterministic graders no-op-pass and no guard", () => {
  const c = makeCase({
    oracle: { solve: "oracle/solve.sh" }, // no noop_max_score
    graders: [
      { type: "files_unchanged", paths: ["a.txt"] },
      { type: "file_exists", path: "out.txt", negate: true },
    ] as GraderSpec[],
  });
  const row = auditCase(c, { fileExists: () => true });
  assert.ok(row.weaknesses.some((w) => w.includes("no-op run")), JSON.stringify(row.weaknesses));
});

test("no-op baseline heuristic: silent when noop_max_score guard is present", () => {
  const c = makeCase({
    oracle: { solve: "oracle/solve.sh", noop_max_score: 0.2 },
    graders: [{ type: "files_unchanged", paths: ["a.txt"] }] as GraderSpec[],
  });
  const row = auditCase(c, { fileExists: () => true });
  assert.ok(!row.weaknesses.some((w) => w.includes("no-op run")), JSON.stringify(row.weaknesses));
});

test("no-op baseline heuristic: silent when a positive deterministic grader has teeth", () => {
  const c = makeCase({
    oracle: { solve: "oracle/solve.sh" },
    graders: [
      { type: "files_unchanged", paths: ["a.txt"] },
      { type: "file_contains", path: "out.txt", pattern: "hello" }, // positive assertion, no-op fails it
    ] as GraderSpec[],
  });
  const row = auditCase(c, { fileExists: () => true });
  assert.ok(!row.weaknesses.some((w) => w.includes("no-op run")), JSON.stringify(row.weaknesses));
});

test("weak-backstop heuristic: fires for rubric_llm whose only deterministic graders are regex_match", () => {
  const c = makeCase({
    oracle: { solve: "oracle/solve.sh", known_bad: ["oracle/bad.sh"] },
    graders: [
      { type: "rubric_llm", rubric: "is it good?" },
      { type: "regex_match", pattern: "answer", source: "final_text" },
    ] as GraderSpec[],
  });
  const row = auditCase(c, { fileExists: () => true });
  assert.ok(
    row.weaknesses.some((w) => w.includes("only regex_match")),
    JSON.stringify(row.weaknesses),
  );
});

test("weak-backstop heuristic: silent when a non-regex deterministic grader backs the judge", () => {
  const c = makeCase({
    oracle: { solve: "oracle/solve.sh", known_bad: ["oracle/bad.sh"] },
    graders: [
      { type: "rubric_llm", rubric: "is it good?" },
      { type: "file_contains", path: "out.txt", pattern: "answer" },
    ] as GraderSpec[],
  });
  const row = auditCase(c, { fileExists: () => true });
  assert.ok(!row.weaknesses.some((w) => w.includes("only regex_match")), JSON.stringify(row.weaknesses));
});

test("auditCases forwards options to every row", () => {
  const cases = [makeCase({ id: "a", oracle: { solve: "oracle/missing.sh" } })];
  const audit = auditCases(cases, { fileExists: () => false });
  assert.ok(audit.cases[0].weaknesses.some((w) => w.startsWith("oracle script missing on disk")));
});

// --- CLI-level guarantees on the REAL corpus ---

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", ["--import", "tsx", "lib/cli/accuracy.ts", ...args], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e: any) {
    return { status: e.status ?? 1, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" };
  }
}

test("current corpus has no dangling oracle scripts", async () => {
  const cases = await loadCases();
  const audit = auditCases(cases, { casesDir: path.join(REPO_ROOT, "cases"), fileExists: (p) => fs.existsSync(p) });
  const dangling = audit.cases.flatMap((c) =>
    c.weaknesses.filter((w) => w.startsWith("oracle script missing on disk")).map((w) => `${c.id}: ${w}`),
  );
  assert.deepEqual(dangling, [], `unexpected dangling oracle scripts: ${JSON.stringify(dangling)}`);
});

test("--strict still exits 0 on the current corpus (no regression)", () => {
  const { status } = runCli(["--strict"]);
  assert.equal(status, 0);
});

test("--strict-known-bad exits 0 on the current corpus (every case now has a known-bad)", () => {
  // The eval-hardening units gave all cases a known-bad rejection script, so
  // the opt-in gate is satisfied. This is the desired end state; the gate's
  // teeth are proven hermetically below rather than by relying on a weak corpus.
  const { status } = runCli(["--strict-known-bad"]);
  assert.equal(status, 0);
});

test("--strict-known-bad gate flags a case that lacks a known-bad script", () => {
  // Drives the exact condition the CLI uses to exit nonzero (c.hasKnownBad),
  // without coupling to the live corpus's health.
  const withKnownBad = auditCases([
    makeCase({ id: "kb", oracle: { solve: "oracle/s.sh", known_bad: ["oracle/b.sh"] } }),
  ]).cases[0];
  const withoutKnownBad = auditCases([makeCase({ id: "nokb", oracle: { solve: "oracle/s.sh" } })]).cases[0];
  assert.equal(withKnownBad.hasKnownBad, true);
  assert.equal(withoutKnownBad.hasKnownBad, false);
  assert.ok(withoutKnownBad.weaknesses.some((w) => /known-bad/.test(w)));
});

test("--help exits 0 and documents --strict-known-bad", () => {
  const { status, stdout } = runCli(["--help"]);
  assert.equal(status, 0);
  assert.match(stdout, /--strict-known-bad/);
});
