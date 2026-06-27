#!/usr/bin/env tsx
import { auditCases, evidenceLabel } from "../accuracy";
import { loadCases } from "../cases";

async function main() {
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
  if (process.argv.includes("--strict") && hardFailures.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
