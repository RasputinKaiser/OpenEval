import fs from "node:fs";
import { auditCases } from "@/lib/accuracy";
import { formatCaseLoadErrors, loadCasesWithErrors } from "@/lib/cases";
import { CASES_DIR } from "@/lib/config";
import AccuracyClient from "@/components/AccuracyClient";
import { resolveJudge } from "@/lib/grader/judge";

export const dynamic = "force-dynamic";

export default async function AccuracyPage() {
  // Keep invalid files visible as corpus evidence instead of allowing them to
  // disappear behind a smaller green denominator. CLI strict mode still fails
  // the process; this route gives an operator the actionable issue list.
  const loaded = await loadCasesWithErrors();
  const audit = auditCases(loaded.cases, {
    casesDir: CASES_DIR,
    fileExists: (candidate) => fs.existsSync(candidate),
    corpusErrors: formatCaseLoadErrors(loaded.errors),
  });
  const judge = resolveJudge();
  return <AccuracyClient audit={audit} judge={judge} />;
}
