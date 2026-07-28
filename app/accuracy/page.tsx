import fs from "node:fs";
import { auditCases } from "@/lib/accuracy";
import { loadCasesStrict } from "@/lib/cases";
import { CASES_DIR } from "@/lib/config";
import AccuracyClient from "@/components/AccuracyClient";

export const dynamic = "force-dynamic";

export default async function AccuracyPage() {
  // Keep the browser receipt aligned with the CLI gate: invalid case files and
  // dangling oracle scripts may not disappear behind a green denominator.
  const cases = await loadCasesStrict();
  const audit = auditCases(cases, { casesDir: CASES_DIR, fileExists: (candidate) => fs.existsSync(candidate) });
  return <AccuracyClient audit={audit} />;
}
