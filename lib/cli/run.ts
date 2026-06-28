#!/usr/bin/env tsx
import { createAndStartRun } from '../run';
import { selectCases } from '../cases';
import { getRun, listRunCases } from '../db';
import { computeSummary } from '../summary';
import type { RunnerKind } from '../types';

interface Args {
  case?: string;
  runner: RunnerKind;
  parallel: number;
  samples: number;
  model?: string;
  name?: string;
  categories: string[];
  tags: string[];
  difficulty: string[];
  watch: boolean;
}

interface ParsedArgs extends Args {
  json: boolean;
  verbose: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const a: ParsedArgs = { runner: 'headless', parallel: 1, samples: 1, categories: [], tags: [], difficulty: [], watch: true, json: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--case': a.case = argv[++i]; break;
      case '--runner': a.runner = (argv[++i] as RunnerKind) || 'headless'; break;
      case '--parallel': a.parallel = parseInt(argv[++i] || '1', 10) || 1; break;
      case '--samples': a.samples = parseInt(argv[++i] || '1', 10) || 1; break;
      case '--model': a.model = argv[++i]; break;
      case '--name': a.name = argv[++i]; break;
      case '--category': a.categories.push(argv[++i]); break;
      case '--tag': a.tags.push(argv[++i]); break;
      case '--difficulty': a.difficulty.push(argv[++i]); break;
      case '--no-watch': a.watch = false; break;
      case '--json': a.json = true; break;
      case '--verbose': a.verbose = true; break;
      case '-h': case '--help':
        console.log(USAGE); process.exit(0);
      default:
        if (!arg.startsWith('-')) {
          if (!a.case) a.case = arg;
        }
    }
  }
  return a;
}

const USAGE = `NEval — run evaluations against the NCode CLI

Usage: npx tsx lib/cli/run.ts [options] [caseId]

Options:
  --case <id>          Run a single case by ID
  --runner <kind>      headless | tmux          (default: headless)
  --parallel <n>       Concurrent cases        (default: 1)
  --samples <k>        Trials per case for pass@k  (default: 1, max 8)
  --model <id|alias>   Model for ncode sessions (default: ncode's default)
  --name <name>        Run name
  --category <cat>     Filter by category (repeatable)
  --tag <tag>          Filter by tag (repeatable)
  --difficulty <tier>  Filter by difficulty easy|medium|hard (repeatable)
  --no-watch           Exit immediately after starting, don't poll status
  --json               Output run summary as JSON and suppress human text
  --verbose            Print stack traces on errors
  -h, --help           Show this help

Examples:
  npx tsx lib/cli/run.ts --case swe-fix-fizzbuzz
  npx tsx lib/cli/run.ts --runner headless --parallel 4 --category agentic-swe
  npx tsx lib/cli/run.ts --model glm-5.2 --samples 3 --difficulty medium
`;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function printError(e: unknown, json: boolean, verbose: boolean, code: number): never {
  const msg = errorMessage(e);
  if (json) {
    console.log(JSON.stringify({ ok: false, error: msg }));
  } else {
    console.error('Error: ' + msg);
  }
  if (verbose && e instanceof Error && e.stack) {
    console.error(e.stack);
  }
  process.exit(code);
}


async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const outputJson = argv.includes('--json');
  const verbose = argv.includes('--verbose') || process.env.DEBUG === '1';
  const log = outputJson ? () => undefined : console.log;

  try {
  const args = parseArgs(argv);
  const filter: any = {};
  if (args.case) filter.caseIds = [args.case];
  if (args.categories.length) filter.categories = args.categories;
  if (args.tags.length) filter.tags = args.tags;
  if (args.difficulty.length) filter.difficulty = args.difficulty;

  const selected = await selectCases(filter);
  if (selected.length === 0) {
    throw new Error('No cases match. Try without filters, or check lib/cases.ts.');
  }

  log('Starting run: ' + selected.length + ' case(s) × ' + args.samples + ' sample(s) — runner=' + args.runner + ' parallel=' + args.parallel + (args.model ? ' model=' + args.model : ''));
  const { id } = await createAndStartRun({
    name: args.name,
    runner: args.runner,
    parallel: args.parallel,
    model: args.model,
    samples: args.samples,
    filter,
  });
  log('Run started: ' + id);
  log('  → Dashboard: http://localhost:3000/runs/' + id);
  log('  → API:       GET /api/runs/' + id);

  if (!args.watch) return 0;

  // Poll until complete
  let lastSig = "";
  while (true) {
    const run = getRun(id);
    if (!run) break;
    const cases = listRunCases(id);
    const sig = cases.map((c) => `${c.seq}:${c.status}`).join(" ");
    if (sig !== lastSig) {
      lastSig = sig;
      if (!outputJson) process.stdout.write("\r" + " ".repeat(80) + "\r");
      const counts = cases.reduce<Record<string, number>>((a, c) => { a[c.status] = (a[c.status] || 0) + 1; return a; }, {});
      const summary = [
        `passed=${counts.passed || 0}`,
        `failed=${counts.failed || 0}`,
        `error=${counts.error || 0}`,
        `running=${(counts.running || 0) + (counts.grading || 0)}`,
        `pending=${counts.pending || 0}`,
      ].join("  ");
      if (!outputJson) process.stdout.write(`[${cases.filter((c) => ["passed","failed","error","skipped"].includes(c.status)).length}/${cases.length}] ${summary}`);
    }
    if (run.status !== "running") break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  const finalRun = getRun(id);
  const finalCases = listRunCases(id);
  const summary = computeSummary(finalCases);

  if (outputJson) {
    console.log(JSON.stringify(summary));
  } else {
    console.log();
    console.log('Run ' + finalRun?.status + ': ' + summary.passed + '/' + summary.total + ' passed (' + (summary.passRate * 100).toFixed(0) + '%)');
    console.log('Cost: $' + summary.totalCostUsd.toFixed(4) + '  Tokens: ↑' + summary.totalTokensIn + '' + summary.totalTokensOut + '  Duration: ' + (summary.totalDurationMs / 1000).toFixed(1) + 's');
    if (summary.byCategory) {
      for (const [cat, s] of Object.entries(summary.byCategory)) {
        console.log('  ' + cat + ': ' + s.passed + '/' + s.total);
      }
    }
  }

  if (finalRun?.status === 'failed') {
    throw new Error('Run did not complete due to an unexpected failure.');
  }

  const graderCrash = finalCases.some((c) => c.status === 'error' && (c.error_msg ?? '').startsWith('Grader threw:'));
  const runnerCrash = finalCases.some((c) => c.status === 'error' && ((c.error_msg ?? '').startsWith('Runner threw:') || c.runner_result?.isError));

  if (graderCrash) return 3;
  if (runnerCrash) return 2;
  return 0;
  } catch (e) {
    printError(e, outputJson, verbose, 1);
  }
}

main().then((code) => process.exit(code)).catch((e) => {
  const json = process.argv.slice(2).includes('--json');
  const verbose = process.argv.slice(2).includes('--verbose') || process.env.DEBUG === '1';
  printError(e, json, verbose, 1);
});
