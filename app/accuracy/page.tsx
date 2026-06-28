import { auditCases } from "@/lib/accuracy";
import { loadCases } from "@/lib/cases";
import AccuracyClient from "@/components/AccuracyClient";

export const dynamic = "force-dynamic";

export default async function AccuracyPage() {
  const cases = await loadCases();
  const audit = auditCases(cases);
  return <AccuracyClient audit={audit} />;
}
