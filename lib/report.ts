import fs from "node:fs/promises";
import path from "node:path";
import { getRun, listRunCases } from "./db";
import { redactSensitiveText } from "./redaction";
import type { CaseEvaluation, GraderResult, RunCaseRecord, RunRecord, RunSummary } from "./types";
import { presentRunnerCost, presentSummaryCost } from "./cost-display";

interface ReportOptions {
  redact?: boolean;
}

type Redactor = (value: unknown) => Promise<string>;

function fmtDate(value: number | null): string {
  return value ? new Date(value).toISOString() : "not ended";
}

function fmtPct(value: number | undefined): string {
  return `${(((value ?? 0) * 100)).toFixed(1)}%`;
}

function fmtMs(value: number | null | undefined): string {
  if (!value) return "0ms";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

function escapeTable(value: unknown): string {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function fenced(value: string, lang = ""): string {
  return `\`\`\`${lang}\n${value.replace(/```/g, "`\u200b``")}\n\`\`\``;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n… (truncated)`;
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "case";
}

async function makeRedactor(redact?: boolean): Promise<Redactor> {
  if (!redact) return async (value) => String(value ?? "");
  const anyRedaction: any = await import("./redaction");
  if (typeof anyRedaction.redactText === "function") {
    return async (value) => anyRedaction.redactText(String(value ?? ""), { pii: false });
  }
  return async (value) => redactSensitiveText(value);
}

// Rebuilds the value (never mutates the input), redacting every string leaf —
// covers finalText/resultText, tool call inputs/outputs, transcript text and
// tool_result content, grader detail/output, and anything nested in rawJson.
async function redactJsonValue(value: unknown, redactor: Redactor): Promise<unknown> {
  if (typeof value === "string") return redactor(value);
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) out.push(await redactJsonValue(item, redactor));
    return out;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = await redactJsonValue(entry, redactor);
    return out;
  }
  return value;
}

function manifestRows(run: RunRecord): Array<[string, string]> | null {
  const manifest = run.manifest as any;
  if (!manifest || typeof manifest !== "object") return null;
  return [
    ["OpenEval version", manifest.openevalVersion],
    ["Node version", manifest.nodeVersion],
    ["Platform", manifest.platform],
    ["Arch", manifest.arch],
    ["OS release", manifest.osRelease],
    ["Created", fmtDate(manifest.createdAt ?? null)],
    ["Harness", `${manifest.harness?.label ?? ""} (${manifest.harness?.id ?? "unknown"})`],
    ["Harness bin", manifest.harness?.bin ?? "not found"],
    ["Harness version", manifest.harness?.version ?? "unknown"],
    ["Model", manifest.model ?? "not set"],
    ["Git SHA", manifest.repo?.gitSha ?? "unknown"],
    ["Git branch", manifest.repo?.gitBranch ?? "unknown"],
    ["Git dirty", manifest.repo?.dirty == null ? "unknown" : String(manifest.repo.dirty)],
    ["Defaults applied", Array.isArray(manifest.defaultsApplied) && manifest.defaultsApplied.length ? manifest.defaultsApplied.join(", ") : "none"],
  ];
}

function summaryLines(summary: RunSummary | null): string[] {
  if (!summary) return ["No summary captured yet."];
  const ci = summary.passAt1Ci95;
  const ciSuffix = ci ? ` (95% CI ${fmtPct(ci.lo)}–${fmtPct(ci.hi)})` : "";
  const lines = [
    `- Pass rate: ${fmtPct(summary.passRate)}${ciSuffix}`,
    `- Passed/failed/errored/skipped: ${summary.passed}/${summary.failed}/${summary.errored}/${summary.skipped}`,
  ];
  if ((summary.samples ?? 1) > 1) {
    lines.push(`- pass@1: ${fmtPct(summary.passAt1)}${ciSuffix} (k=${summary.samples})`);
    lines.push(`- pass@k: ${fmtPct(summary.passAtK)}`);
    lines.push(`- pass^k (reliability): ${fmtPct(summary.passPowK)}`);
  }
  const cost = presentSummaryCost(summary, 6);
  lines.push(`- ${cost.label} USD: ${cost.value}`);
  lines.push(`- Tokens in/out: ${summary.totalTokensIn}/${summary.totalTokensOut}`);
  lines.push(`- Duration: ${fmtMs(summary.totalDurationMs)}`);
  return lines;
}

function categoryTable(summary: RunSummary | null): string[] {
  if (!summary || Object.keys(summary.byCategory).length === 0) return [];
  const lines = ["", "| Category | Total | Passed | Failed | Errored |", "| --- | ---: | ---: | ---: | ---: |"];
  for (const [category, row] of Object.entries(summary.byCategory)) {
    lines.push(`| ${escapeTable(category)} | ${row.total} | ${row.passed} | ${row.failed} | ${row.errored} |`);
  }
  return lines;
}

async function graderTable(c: RunCaseRecord, redactor: Redactor): Promise<string[]> {
  const evaluation: CaseEvaluation | null = c.evaluation ?? c.grader_result;
  const results = evaluation?.results ?? [];
  const lines = ["| Type | Weight | Passed | Evidence tier | Detail |", "| --- | ---: | --- | --- | --- |"];
  if (results.length === 0) {
    lines.push("| not captured | 0 | unknown | unknown |  |");
    return lines;
  }
  for (const result of results as GraderResult[]) {
    const spec = result.spec as any;
    const detail = truncate(await redactor(result.detail), 200);
    lines.push(`| ${escapeTable(spec?.type ?? "unknown")} | ${escapeTable(spec?.weight ?? 1)} | ${result.passed ? "yes" : "no"} | ${escapeTable(result.evidenceTier ?? "unknown")} | ${escapeTable(detail)} |`);
  }
  return lines;
}

function toolTable(c: RunCaseRecord): string[] {
  const counts = c.runner_result?.toolCallCounts ?? {};
  const lines = ["| Name | Count |", "| --- | ---: |"];
  const entries = Object.entries(counts);
  if (entries.length === 0) {
    lines.push("| none | 0 |");
    return lines;
  }
  for (const [name, count] of entries) lines.push(`| ${escapeTable(name)} | ${count} |`);
  return lines;
}

export async function buildRunReport(runId: string, opts?: ReportOptions): Promise<string> {
  const run = getRun(runId);
  if (!run) throw new Error(`run not found: ${runId}`);
  const cases = listRunCases(runId);
  const redactor = await makeRedactor(opts?.redact);
  const lines: string[] = [];

  lines.push(`# ${await redactor(run.name)} (${run.id})`);
  lines.push("");
  lines.push(`- Status: ${run.status}`);
  lines.push(`- Created: ${fmtDate(run.created_at)}`);
  lines.push(`- Ended: ${fmtDate(run.ended_at)}`);
  lines.push("");
  lines.push("## Manifest");
  const rows = manifestRows(run);
  if (!rows) {
    lines.push("not captured");
  } else {
    lines.push("| Field | Value |");
    lines.push("| --- | --- |");
    for (const [field, value] of rows) lines.push(`| ${escapeTable(field)} | ${escapeTable(await redactor(value))} |`);
  }
  lines.push("");
  lines.push("## Summary");
  lines.push(...summaryLines(run.summary));
  lines.push(...categoryTable(run.summary));

  for (const c of cases) {
    lines.push("");
    lines.push(`## Case: ${await redactor(c.case_name)} (${c.case_id})`);
    if ((c.sample ?? 0) > 0) lines.push(`- Sample: ${c.sample}`);
    lines.push(`- Verdict: ${c.status}`);
    lines.push(`- Duration: ${fmtMs(c.runner_result?.durationMs ?? (c.ended_at && c.started_at ? c.ended_at - c.started_at : null))}`);
    const caseCost = c.runner_result ? presentRunnerCost(c.runner_result.usage, 6) : { label: "Cost", value: "missing" };
    lines.push(`- ${caseCost.label} USD: ${caseCost.value}`);
    lines.push(`- Tokens in/out: ${c.runner_result?.usage.inputTokens ?? 0}/${c.runner_result?.usage.outputTokens ?? 0}`);
    lines.push("");
    lines.push("### Graders");
    lines.push(...await graderTable(c, redactor));
    lines.push("");
    lines.push("### Final answer");
    lines.push(fenced(truncate(await redactor(c.runner_result?.finalText ?? ""), 4000)));
    lines.push("");
    lines.push("### Tool calls");
    lines.push(...toolTable(c));
    if (c.error_msg) {
      lines.push("");
      lines.push(`> ${escapeTable(await redactor(c.error_msg))}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function writeRunBundle(
  runId: string,
  outDir: string,
  opts?: ReportOptions
): Promise<{ dir: string; files: string[] }> {
  const run = getRun(runId);
  if (!run) throw new Error(`run not found: ${runId}`);
  const cases = listRunCases(runId);
  const files: string[] = [];
  const redactor = opts?.redact ? await makeRedactor(true) : null;
  await fs.mkdir(outDir, { recursive: true });

  async function writeJson(rel: string, value: unknown) {
    const target = path.join(outDir, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const payload = redactor ? await redactJsonValue(value, redactor) : value;
    await fs.writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    files.push(rel);
  }

  const report = await buildRunReport(runId, opts);
  await fs.writeFile(path.join(outDir, "report.md"), report, "utf8");
  files.push("report.md");
  await writeJson("manifest.json", run.manifest ?? null);
  await writeJson("summary.json", run.summary ?? null);

  for (const c of cases) {
    const caseDir = path.join("cases", `${sanitizePathPart(c.case_id)}-s${c.sample ?? 0}`);
    await writeJson(path.join(caseDir, "runner-result.json"), c.runner_result ?? null);
    await writeJson(path.join(caseDir, "grader-result.json"), c.grader_result ?? c.evaluation ?? null);
    await writeJson(path.join(caseDir, "transcript.json"), c.runner_result?.transcript ?? null);
  }

  return { dir: outDir, files };
}
