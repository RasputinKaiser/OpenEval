#!/usr/bin/env tsx
import { auditCases, evidenceLabel } from "../accuracy";
import { loadCases } from "../cases";

const HELP = `Usage: tsx lib/cli/accuracy.ts [options]

Audits the case corpus for grader-accuracy weaknesses (missing oracle, no
known-bad rejection, no deterministic backstop, no-op-passable graders, weak
regex-only backstops behind an LLM judge, missing oracle scripts on disk).

Options:
  --strict            Exit nonzero if any case lacks an oracle or a
                      deterministic/trace grader. (unchanged)
  --strict-known-bad  Additionally exit nonzero if any case lacks a known-bad
                      rejection script. Opt-in; leaves --strict untouched.
  -h, --help          Show this help.`;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(HELP);
    return;
  }

  const cases = await loadCases();
  const audit = auditCases(cases);

  console.log(`Accuracy audit: ${audit.totalCases} cases`);
  console.log(`  oracle coverage: ${audit.oracleCases}/${audit.totalCases}`);
  console.log(`  known-bad scripts: ${audit.knownBadCases}/${audit.totalCases}`);
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

  const hardFailures = weak.filter((c) => !c.hasOracle || c.tiers.deterministic + c.tiers.trace === 0);
  if (argv.includes("--strict") && hardFailures.length) process.exit(1);

  // Opt-in: promote the "no known-bad rejection" weakness to a hard failure.
  // Independent of --strict so existing --strict behavior is unchanged.
  const knownBadFailures = audit.cases.filter((c) => !c.hasKnownBad);
  if (argv.includes("--strict-known-bad") && knownBadFailures.length) {
    console.error(`\n--strict-known-bad: ${knownBadFailures.length} case(s) lack a known-bad rejection script:`);
    for (const c of knownBadFailures) console.error(`  - ${c.id}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
