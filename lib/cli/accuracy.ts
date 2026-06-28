#!/usr/bin/env tsx
import { auditCases, evidenceLabel } from "../accuracy";
import type { AccuracyAudit } from "../accuracy";
import { loadCases } from "../cases";

function parseFlags(argv: string[]) {
  const flags = {
    strict: argv.includes("--strict"),
    requireOracle: argv.includes("--require-oracle"),
    requireDeterministic: argv.includes("--require-deterministic"),
    requireKnownBad: argv.includes("--require-known-bad"),
    json: argv.includes("--json"),
    help: argv.includes("--help") || argv.includes("-h"),
  };
  return flags;
}

function printHuman(audit: AccuracyAudit) {
  console.log(`Accuracy audit: ${audit.totalCases} cases`);
  console.log(`  oracle coverage: ${audit.oracleCases}/${audit.oracleApplicableCases} applicable (${audit.totalCases - audit.oracleApplicableCases} inapplicable)`);
  console.log(`  known-bad probes: ${audit.knownBadCases}/${audit.totalCases}`);
  console.log(`  deterministic/trace coverage: ${audit.deterministicOrTraceCases}/${audit.totalCases}`);
  console.log(`  visual contracts: ${audit.visualCases}`);
  console.log(`  vision-input cases: ${audit.visionInputCases}`);
  console.log("  evidence tiers:");
  for (const [tier, count] of Object.entries(audit.tierTotals)) {
    console.log(`    ${evidenceLabel(tier as any).padEnd(14)} ${count}`);
  }

  const weak = audit.cases.filter((c) => c.weaknesses.length > 0);
  if (weak.length) {
    console.log("\nWeak cases:");
    for (const c of weak) {
      console.log(`  - ${c.id}: ${c.weaknesses.join("; ")}`);
    }
  }
}

function computeHardFailures(audit: AccuracyAudit, flags: ReturnType<typeof parseFlags>) {
  const requireOracle = flags.strict || flags.requireOracle;
  const requireDeterministic = flags.strict || flags.requireDeterministic;
  const requireKnownBad = flags.requireKnownBad;

  const failures: string[] = [];

  for (const c of audit.cases) {
    if (requireOracle && c.oracleApplicable && !c.hasOracle) {
      failures.push(`${c.id}: missing oracle solve script`);
    }
    if (requireDeterministic && c.tiers.deterministic + c.tiers.trace === 0) {
      failures.push(`${c.id}: no deterministic or trace grader`);
    }
    if (requireKnownBad && !c.hasKnownBad) {
      failures.push(`${c.id}: no known-bad rejection script`);
    }
  }

  return failures;
}

async function main() {
  const flags = parseFlags(process.argv);

  if (flags.help) {
    console.log(`Usage: tsx lib/cli/accuracy.ts [flags]

Flags:
  --json                  Output full audit as JSON to stdout (always exits 0)
  --strict                Exit 1 if any case is missing oracle or deterministic grader
  --require-oracle        Exit 1 if any applicable case lacks an oracle
  --require-deterministic Exit 1 if any case has no deterministic/trace grader
  --require-known-bad     Exit 1 if any case lacks a known-bad probe
  --help, -h              Show this help
`);
    return;
  }

  const cases = await loadCases();
  const audit = auditCases(cases);

  if (flags.json) {
    console.log(JSON.stringify(audit, null, 2));
    return;
  }

  printHuman(audit);

  const failures = computeHardFailures(audit, flags);
  if (failures.length) {
    console.log(`\n${failures.length} hard failure(s):`);
    for (const f of failures) console.log(`  ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});