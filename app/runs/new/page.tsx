import { loadCases } from "@/lib/cases";
import NewRunClient from "@/components/NewRunClient";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: { caseIds?: string | string[] } }) {
  const cases = await loadCases();
  const rawCaseIds = Array.isArray(searchParams.caseIds) ? searchParams.caseIds : searchParams.caseIds ? [searchParams.caseIds] : [];
  const initialCaseIds = rawCaseIds.flatMap((value) => value.split(",")).map((id) => id.trim()).filter(Boolean);
  return <NewRunClient cases={cases} initialCaseIds={initialCaseIds} />;
}
