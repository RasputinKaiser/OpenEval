#!/usr/bin/env tsx
import { createAndStartRun } from '../run';
import { selectCases } from '../cases';
import { getRun, listRunCases } from '../db';
import { computeSummary } from '../summary';
import { isTerminalCaseStatus } from '../status';
import { listAdapters, getDefaultHarness } from '../adapters/registry';
import { discoverHarnesses } from '../adapters/discover';
import type { RunnerKind } from '../types';

interface Args {
  case?: string;
  runner: RunnerKind;
  harnesses: string[];
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
  listHarnesses: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const a: ParsedArgs = { runner: 'headless', harnesses: [], parallel: 1, samples: 1, categories: [], tags: [], difficulty: [], watch: true, json: false, verbose: false, listHarnesses: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--case': a.case = argv[++i]; break;
      case '--runner': a.runner = (argv[++i] as RunnerKind) || 'headless'; break;
      case '--harness': a.harnesses.push(argv[++i]); break;
      case '--list-harnesses': a.listHarnesses = true; break;
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

const USAGE = `OpenEval — run evaluations against any agent CLI harness

Usage: npx tsx lib/cli/run.ts [options] [caseId]

Options:
  --case <id>          Run a single case by ID
  --runner <kind>      headless | tmux          (default: headless)
  --harness <id>      Agent CLI to run against (repeatable to fan across harnesses; default: ${getDefaultHarness()})
  --list-harnesses     List registered harness adapters and exit
  --parallel <n>       Concurrent cases        (default: 1)
  --samples <k>        Trials per case for pass@k  (default: 1, max 8)
  --model <id|alias>   Model for the harness sessions (default: harness default)
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
  npx tsx lib/cli/run.ts --harness claude-code --harness codex --samples 3
`;

function listHarnesses(): Promise<void> {
  const known = listAdapters();
  console.log('Probing harnesses on PATH…');
  return discoverHarnesses(true).then((discovered) => {
    const byId = new Map(discovered.map((h) => [h.id, h]));
    console.log('');
    for (const a of known) {
      const h = byId.get(a.id);
      const tag = a.id === getDefaultHarness() ? ' (default)' : '';
      if (!h) { console.log(`  ${a.id}${tag}  — ${a.label}  [bin: ${a.defaultBin}]`); continue; }
      const bin = h.bin ?? '—';
      const ver = h.version ?? '';
      console.log(`  ${h.id}${tag}  ${h.status.padEnd(11)} ${bin}${ver ? '  ' + ver : ''}${h.status !== 'available' && h.detail ? '  (' + h.detail + ')' : ''}`);
    }
    const avail = discovered.filter((h) => h.status === 'available').length;
    console.log(`\n${avail}/${discovered.length} harness binary(ies) available on PATH.`);
  });
}

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
  if (args.listHarnesses) {
    await listHarnesses();
    return 0;
  }
  const filter: any = {};
  if (args.case) filter.caseIds = [args.case];
  if (args.categories.length) filter.categories = args.categories;
  if (args.tags.length) filter.tags = args.tags;
  if (args.difficulty.length) filter.difficulty = args.difficulty;

  const selected = await selectCases(filter);
  if (selected.length === 0) {
    throw new Error('No cases match. Try without filters, or check lib/cases.ts.');
  }

  const harnesses = args.harnesses.length > 0 ? args.harnesses : [getDefaultHarness()];
  const fanOut = harnesses.length > 1;
  if (fanOut) {
    log('Fanning across ' + harnesses.length + ' harnesses: ' + harnesses.join(', '));
  }

  const started: Array<{ id: string; harness: string }> = [];
  for (const harness of harnesses) {
    const label = fanOut ? `[${harness}] ` : '';
    log(label + 'Starting run: ' + selected.length + ' case(s) × ' + args.samples + ' sample(s) — runner=' + args.runner + ' parallel=' + args.parallel + (args.model ? ' model=' + args.model : ''));
    const runName = args.name ? (fanOut ? `${args.name} · ${harness}` : args.name) : (fanOut ? `Run ${new Date().toISOString().replace('T', ' ').slice(0, 19)} · ${harness}` : undefined);
    const { id } = await createAndStartRun({
      name: runName,
      runner: args.runner,
      harness,
      parallel: args.parallel,
      model: args.model,
      samples: args.samples,
      filter,
    });
    started.push({ id, harness });
    log(label + 'Run started: ' + id);
    log(label + '  → Dashboard: http://localhost:3000/runs/' + id);
  }

  // Runs execute in-process (createAndStartRun launches runLoop and returns
  // immediately), so this CLI MUST wait for every started run to finish — the
  // top-level process.exit would otherwise abort the in-process work. --no-watch
  // only suppresses the live progress line; it still waits. And a fan-out must
  // watch ALL runs, not just the first.
  const showLive = args.watch && !outputJson;
  if (showLive && fanOut) log('Watching ' + started.length + ' runs in parallel…');
  await Promise.all(started.map((s) => waitForRun(s.id, showLive, fanOut ? `[${s.harness}] ` : '')));

  let worstCode = 0;
  const jsonSummaries: Array<{ harness: string; id: string; summary: ReturnType<typeof computeSummary> }> = [];
  for (const s of started) {
    const finalRun = getRun(s.id);
    const finalCases = listRunCases(s.id);
    const summary = computeSummary(finalCases);
    const label = fanOut ? `[${s.harness}] ` : '';
    if (!outputJson) {
      console.log();
      console.log(label + 'Run ' + finalRun?.status + ': ' + summary.passed + '/' + summary.total + ' passed (' + (summary.passRate * 100).toFixed(0) + '%)');
      console.log(label + 'Cost: $' + summary.totalCostUsd.toFixed(4) + '  Tokens: ↑' + summary.totalTokensIn + ' ↓' + summary.totalTokensOut + '  Duration: ' + (summary.totalDurationMs / 1000).toFixed(1) + 's');
      for (const [cat, c] of Object.entries(summary.byCategory)) {
        console.log(label + '  ' + cat + ': ' + c.passed + '/' + c.total);
      }
    }
    jsonSummaries.push({ harness: s.harness, id: s.id, summary });
    if (finalRun?.status === 'failed') log(label + 'Run did not complete due to an unexpected failure.');
    worstCode = Math.max(worstCode, exitCodeForRun(finalRun?.status ?? null, finalCases));
  }

  if (outputJson) {
    console.log(JSON.stringify(fanOut ? { runs: jsonSummaries } : (jsonSummaries[0]?.summary ?? null)));
  }
  return worstCode;
  } catch (e) {
    printError(e, outputJson, verbose, 1);
  }
}

async function waitForRun(id: string, live: boolean, label: string): Promise<void> {
  let lastSig = '';
  while (true) {
    const run = getRun(id);
    if (!run) break;
    const cases = listRunCases(id);
    if (live) {
      const sig = cases.map((c) => `${c.seq}:${c.status}`).join(' ');
      if (sig !== lastSig) {
        lastSig = sig;
        const counts = cases.reduce<Record<string, number>>((a, c) => { a[c.status] = (a[c.status] || 0) + 1; return a; }, {});
        const done = cases.filter((c) => isTerminalCaseStatus(c.status)).length;
        const body = `${label}[${done}/${cases.length}] passed=${counts.passed || 0}  failed=${counts.failed || 0}  error=${counts.error || 0}  running=${(counts.running || 0) + (counts.grading || 0)}  pending=${counts.pending || 0}`;
        // Fan-out prints full lines (concurrent \r would clobber each other);
        // a single run updates one line in place.
        if (label) process.stdout.write(body + '\n');
        else process.stdout.write('\r' + ' '.repeat(80) + '\r' + body);
      }
    }
    if (run.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

function exitCodeForRun(status: string | null, finalCases: ReturnType<typeof listRunCases>): number {
  if (status === 'failed') return 1;
  const graderCrash = finalCases.some((c) => c.status === 'error' && (c.error_msg ?? '').startsWith('Grader threw:'));
  if (graderCrash) return 3;
  // ANY infra error — runner crash, workdir prep failure, judge unavailable,
  // stranded case — must be a nonzero exit; CI treating a broken eval as green
  // is worse than a false alarm.
  const anyInfraError = finalCases.some(
    (c) => c.status === 'error' || !isTerminalCaseStatus(c.status),
  );
  if (anyInfraError) return 2;
  return 0;
}

main().then((code) => process.exit(code)).catch((e) => {
  const json = process.argv.slice(2).includes('--json');
  const verbose = process.argv.slice(2).includes('--verbose') || process.env.DEBUG === '1';
  printError(e, json, verbose, 1);
});
