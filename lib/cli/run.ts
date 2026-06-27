#!/usr/bin/env tsx
import { createAndStartRun } from "../run";
import { selectCases } from "../cases";
import { getRun, listRunCases } from "../db";
import { computeSummary } from "../summary";
import type { RunnerKind } from "../types";

interface Args {
  case?: string;
  runner: RunnerKind;
  parallel: number;
  name?: string;
  categories: string[];
  tags: string[];
  watch: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { runner: "headless", parallel: 1, categories: [], tags: [], watch: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--case": a.case = argv[++i]; break;
      case "--runner": a.runner = (argv[++i] as RunnerKind) || "headless"; break;
      case "--parallel": a.parallel = parseInt(argv[++i] || "1", 10) || 1; break;
      case "--name": a.name = argv[++i]; break;
      case "--category": a.categories.push(argv[++i]); break;
      case "--tag": a.tags.push(argv[++i]); break;
      case "--no-watch": a.watch = false; break;
      case "-h": case "--help":
        console.log(USAGE); process.exit(0);
      default:
        if (!arg.startsWith("-")) {
          // first positional = case id
          if (!a.case) a.case = arg;
        }
    }
  }
  return a;
}

const USAGE = `NCode Evals — run evaluations against the NCode CLI

Usage: npx tsx lib/cli/run.ts [options] [caseId]

Options:
  --case <id>          Run a single case by ID
  --runner <kind>      headless | tmux          (default: headless)
  --parallel <n>       Concurrent cases        (default: 1)
  --name <name>        Run name
  --category <cat>     Filter by category (repeatable)
  --tag <tag>          Filter by tag (repeatable)
  --no-watch           Exit immediately after starting, don't poll status
  -h, --help           Show this help

Examples:
  npx tsx lib/cli/run.ts --case swe-fix-fizzbuzz
  npx tsx lib/cli/run.ts --runner headless --parallel 4 --category agentic-swe
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filter: any = {};
  if (args.case) filter.caseIds = [args.case];
  if (args.categories.length) filter.categories = args.categories;
  if (args.tags.length) filter.tags = args.tags;

  const selected = await selectCases(filter);
  if (selected.length === 0) {
    console.error("No cases match. Try without filters, or check lib/cases.ts.");
    process.exit(1);
  }

  console.log(`Starting run: ${selected.length} case(s) — runner=${args.runner} parallel=${args.parallel}`);
  const { id } = await createAndStartRun({
    name: args.name,
    runner: args.runner,
    parallel: args.parallel,
    filter,
  });
  console.log(`Run started: ${id}`);
  console.log(`  → Dashboard: http://localhost:3000/runs/${id}`);
  console.log(`  → API:       GET /api/runs/${id}`);

  if (!args.watch) return;

  // Poll until complete
  let lastSig = "";
  while (true) {
    const run = getRun(id);
    if (!run) break;
    const cases = listRunCases(id);
    const sig = cases.map((c) => `${c.seq}:${c.status}`).join(" ");
    if (sig !== lastSig) {
      lastSig = sig;
      process.stdout.write("\r" + " ".repeat(80) + "\r");
      const counts = cases.reduce<Record<string, number>>((a, c) => { a[c.status] = (a[c.status] || 0) + 1; return a; }, {});
      const summary = [
        `passed=${counts.passed || 0}`,
        `failed=${counts.failed || 0}`,
        `error=${counts.error || 0}`,
        `running=${(counts.running || 0) + (counts.grading || 0)}`,
        `pending=${counts.pending || 0}`,
      ].join("  ");
      process.stdout.write(`[${cases.filter((c) => ["passed","failed","error","skipped"].includes(c.status)).length}/${cases.length}] ${summary}`);
    }
    if (run.status !== "running") break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  const finalRun = getRun(id);
  const finalCases = listRunCases(id);
  const summary = computeSummary(finalCases);
  process.stdout.write("\n");
  console.log(`\nRun ${finalRun?.status}: ${summary.passed}/${summary.total} passed (${(summary.passRate * 100).toFixed(0)}%)`);
  console.log(`Cost: $${summary.totalCostUsd.toFixed(4)}  Tokens: ↑${summary.totalTokensIn} ↓${summary.totalTokensOut}  Duration: ${(summary.totalDurationMs / 1000).toFixed(1)}s`);
  if (summary.byCategory) {
    for (const [cat, s] of Object.entries(summary.byCategory)) {
      console.log(`  ${cat}: ${s.passed}/${s.total}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });