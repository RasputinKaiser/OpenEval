#!/usr/bin/env tsx
import path from "node:path";
import { getRun } from "../db";
import { buildRunReport, writeRunBundle } from "../report";

interface Args {
  runId: string | null;
  out: string | null;
  bundle: boolean;
  redact: boolean;
  json: boolean;
  help: boolean;
}

function usage() {
  console.log(`Usage: tsx lib/cli/report.ts <runId> [--out <dir>] [--bundle] [--redact] [--json]

Default: print report markdown to stdout.

Options:
  --out <dir>   Write a bundle to dir.
  --bundle      Write a bundle to data/reports/<runId> unless --out is set.
  --redact      Redact sensitive local text fields.
  --json        Print machine-readable results or errors.
  -h, --help    Show this help.`);
}

function parse(argv: string[]): Args {
  const args: Args = { runId: null, out: null, bundle: false, redact: false, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "-h" || token === "--help") args.help = true;
    else if (token === "--out") args.out = argv[++i] ?? null;
    else if (token === "--bundle") args.bundle = true;
    else if (token === "--redact") args.redact = true;
    else if (token === "--json") args.json = true;
    else if (!args.runId) args.runId = token;
    else throw new Error(`unknown argument: ${token}`);
  }
  return args;
}

async function main() {
  const args = parse(process.argv.slice(2));
  if (args.help || !args.runId) {
    usage();
    return;
  }

  const run = getRun(args.runId);
  if (!run) {
    const error = `run not found: ${args.runId}`;
    if (args.json) console.error(JSON.stringify({ ok: false, error }));
    else console.error(error);
    process.exit(1);
  }

  if (args.bundle || args.out) {
    const dir = args.out ?? path.join("data", "reports", args.runId);
    const result = await writeRunBundle(args.runId, dir, { redact: args.redact });
    if (args.json) {
      console.log(JSON.stringify({ ok: true, ...result }));
    } else {
      console.log(`Wrote report bundle: ${result.dir}`);
      for (const file of result.files) console.log(`- ${file}`);
    }
    return;
  }

  const report = await buildRunReport(args.runId, { redact: args.redact });
  process.stdout.write(report);
}

main().catch((e) => {
  console.error(e?.message ?? String(e));
  process.exit(1);
});
