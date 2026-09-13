"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import type {
  CalibrationMethodReport,
  CalibrationReference,
  CalibrationReferenceProvenance,
  CalibrationReport,
} from "@/lib/calibration";

const DEFAULT_OBSERVATIONS = `[
  {
    "recordId": "fixture-observation-1",
    "referenceId": "replace-with-reference-id",
    "referenceVersion": 1,
    "provenance": "synthetic",
    "sourceId": "source-id",
    "sessionId": "session-id",
    "evidenceDigest": "packet-digest",
    "evidenceVersion": "evidence-packet.v1",
    "rubric": "goal-rubric-v1",
    "outcome": "achieved",
    "citedEvidenceIds": ["evidence-id"],
    "evidenceInventoryIds": ["evidence-id"],
    "backend": "fixture",
    "model": "fixture-model",
    "reasoningEffort": "none",
    "promptVersion": 1,
    "costUsd": null,
    "elapsedMs": null
  }
]`;

type Outcome = "achieved" | "partial" | "not_achieved" | "insufficient_evidence";

const inputClass = "analysis-input w-full";

function displayRate(rate: number | null) {
  return rate === null ? "Unavailable" : `${Math.round(rate * 100)}%`;
}

function displayRatio(numerator: number, denominator: number) {
  return `${numerator}/${denominator}`;
}

function sourceHref(reference: Pick<CalibrationReference, "sourceId" | "sessionId">) {
  const params = new URLSearchParams({ sourceId: reference.sourceId, sessionId: reference.sessionId });
  return `/collection/session?${params.toString()}`;
}

function MethodReport({ method }: { method: CalibrationMethodReport }) {
  return (
    <article className="rounded-md border border-bd-subtle p-3" aria-label={`Calibration method ${method.model}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{method.backend} / {method.model}</h3>
        <span className="text-[10px] text-fg-dim mono">{method.reasoningEffort} · prompt {method.promptVersion}</span>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Agreement · human" value={displayRate(method.agreementRate)} detail={`${displayRatio(method.agreementNumerator, method.agreementDenominator)} human references`} />
        <Metric label="False success · human" value={displayRate(method.falseSuccessRate)} detail={`${displayRatio(method.falseSuccessNumerator, method.falseSuccessDenominator)} achieved predictions`} />
        <Metric label="Abstention · human" value={displayRate(method.abstentionRate)} detail={`${displayRatio(method.abstentionNumerator, method.abstentionDenominator)} human references`} />
        <Metric label="Citation validity · human" value={displayRate(method.citationValidityRate)} detail={`${displayRatio(method.citationValidNumerator, method.citationDenominator)} cited IDs · ${method.citationUnknownJudgments} unknown`} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-fg-dim">
        <span>Repeatability: {displayRate(method.repeatabilityRate)} ({displayRatio(method.repeatabilityStablePairs, method.repeatabilityPairs)} repeated pairs)</span>
        <span>Cost: {method.costUsdCount ? `$${method.costUsdTotal.toFixed(4)} across ${method.costUsdCount}` : "Unavailable"}</span>
        <span>Time: {method.elapsedMsCount ? `${Math.round(method.elapsedMsTotal)} ms across ${method.elapsedMsCount}` : "Unavailable"}</span>
        {method.unmatchedObservations > 0 && <span className="text-warn">{method.unmatchedObservations} unmatched</span>}
      </div>
    </article>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-md border border-bd-subtle bg-bg-subtle p-2">
      <div className="text-[10px] uppercase tracking-[0.1em] text-fg-muted">{label}</div>
      <div className="mt-0.5 text-sm font-medium mono">{value}</div>
      <div className="mt-0.5 text-[10px] text-fg-dim">{detail}</div>
    </div>
  );
}

export default function CalibrationWorkbench() {
  const [report, setReport] = useState<CalibrationReport | null>(null);
  const [references, setReferences] = useState<CalibrationReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [referenceId, setReferenceId] = useState("");
  const [label, setLabel] = useState("");
  const [authorLabel, setAuthorLabel] = useState("");
  const [provenance, setProvenance] = useState<CalibrationReferenceProvenance>("synthetic");
  const [humanAttestation, setHumanAttestation] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [evidenceDigest, setEvidenceDigest] = useState("");
  const [evidenceVersion, setEvidenceVersion] = useState("evidence-packet.v1");
  const [rubric, setRubric] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("achieved");
  const [rationale, setRationale] = useState("");
  const [citedEvidenceIds, setCitedEvidenceIds] = useState("");
  const [observationJson, setObservationJson] = useState(DEFAULT_OBSERVATIONS);

  const refresh = async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const [reportResponse, referencesResponse] = await Promise.all([
        fetch("/api/calibration?view=report", { cache: "no-store", signal }),
        fetch("/api/calibration?view=references", { cache: "no-store", signal }),
      ]);
      if (!reportResponse.ok || !referencesResponse.ok) throw new Error("Calibration data could not be loaded.");
      const nextReport = await reportResponse.json() as CalibrationReport;
      const nextReferences = await referencesResponse.json() as { references?: CalibrationReference[] };
      setReport(nextReport);
      setReferences(nextReferences.references ?? []);
    } catch (caught) {
      if ((caught as Error).name !== "AbortError") setError(caught instanceof Error ? caught.message : "Calibration data could not be loaded.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, []);

  const post = async (body: unknown) => {
    const response = await fetch("/api/calibration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({})) as { message?: string; detail?: string };
    if (!response.ok) throw new Error(payload.detail || payload.message || "Calibration request failed.");
    return payload;
  };

  const saveReference = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true); setError(null); setNotice(null);
    try {
      const ids = citedEvidenceIds.split(",").map((id) => id.trim()).filter(Boolean);
      await post({
        action: "create_reference",
        reference: {
          ...(referenceId.trim() ? { referenceId: referenceId.trim() } : {}),
          label, authorLabel, provenance, humanAttestation,
          sourceId, sessionId, evidenceDigest, evidenceVersion, rubric, outcome, rationale,
          citedEvidenceIds: ids,
        },
      });
      setNotice(`${provenance === "human" ? "Human" : provenance} reference saved as a new immutable version.`);
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Reference could not be saved."); }
    finally { setSaving(false); }
  };

  const importObservations = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true); setError(null); setNotice(null);
    try {
      const parsed: unknown = JSON.parse(observationJson);
      const observations = Array.isArray(parsed) ? parsed : [parsed];
      const result = await post({ action: "import_observations", observations });
      setNotice(`Imported ${Number((result as { inserted?: number }).inserted ?? 0)} new observation(s); repeated identical records remain unchanged.`);
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Observations could not be imported."); }
    finally { setSaving(false); }
  };

  return (
    <section className="card mb-5 p-4" aria-labelledby="calibration-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-accent-soft">Calibration workbench</div>
          <h2 id="calibration-title" className="mt-1 text-base font-medium">Compare retained reviews with versioned references</h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-fg-muted">Author a human or synthetic reference against an exact evidence packet, then import structured review observations. This local workbench never runs a provider; synthetic fixtures stay outside human denominators.</p>
        </div>
        {loading && <span className="text-[11px] text-fg-dim mono">Loading calibration…</span>}
      </div>

      {error && <div className="mt-3 rounded-md border border-err p-2.5 text-xs text-err" role="alert">{error}</div>}
      {notice && <div className="mt-3 rounded-md border border-ok p-2.5 text-xs text-ok" role="status">{notice}</div>}

      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium">Author a reference version</summary>
        <form className="mt-3 grid gap-3 md:grid-cols-2" onSubmit={saveReference}>
          <Field label="Reference ID (optional)"><input className={inputClass} value={referenceId} onChange={(event) => setReferenceId(event.target.value)} placeholder="generated when empty" /></Field>
          <Field label="Label"><input className={inputClass} required value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. goal card review" /></Field>
          <Field label="Author label"><input className={inputClass} required value={authorLabel} onChange={(event) => setAuthorLabel(event.target.value)} placeholder="operator or fixture" /></Field>
          <Field label="Provenance"><select className={inputClass} value={provenance} onChange={(event) => setProvenance(event.target.value as CalibrationReferenceProvenance)}><option value="synthetic">Synthetic / test</option><option value="human">Human reviewed</option><option value="imported">Imported reference</option></select></Field>
          <Field label="Source ID"><input className={inputClass} required value={sourceId} onChange={(event) => setSourceId(event.target.value)} /></Field>
          <Field label="Session ID"><input className={inputClass} required value={sessionId} onChange={(event) => setSessionId(event.target.value)} /></Field>
          <Field label="Evidence digest"><input className={inputClass} required value={evidenceDigest} onChange={(event) => setEvidenceDigest(event.target.value)} /></Field>
          <Field label="Evidence version"><input className={inputClass} required value={evidenceVersion} onChange={(event) => setEvidenceVersion(event.target.value)} /></Field>
          <Field label="Rubric"><input className={inputClass} required value={rubric} onChange={(event) => setRubric(event.target.value)} placeholder="goal-rubric-v1" /></Field>
          <Field label="Reviewed outcome"><select className={inputClass} value={outcome} onChange={(event) => setOutcome(event.target.value as Outcome)}><option value="achieved">Achieved</option><option value="partial">Partial</option><option value="not_achieved">Not achieved</option><option value="insufficient_evidence">Insufficient evidence</option></select></Field>
          <Field label="Cited evidence IDs (comma separated)"><input className={inputClass} value={citedEvidenceIds} onChange={(event) => setCitedEvidenceIds(event.target.value)} placeholder="receipt-1, check-2" /></Field>
          <Field label="Rationale"><textarea className={`${inputClass} min-h-20`} required value={rationale} onChange={(event) => setRationale(event.target.value)} /></Field>
          {provenance === "human" && <label className="flex items-start gap-2 text-xs text-fg-muted md:col-span-2"><input className="mt-0.5" type="checkbox" checked={humanAttestation} onChange={(event) => setHumanAttestation(event.target.checked)} />I attest that this reference was reviewed by a human operator.</label>}
          <div className="flex flex-wrap items-center gap-3 md:col-span-2">
            <button className="analysis-control" type="submit" disabled={saving}>{saving ? "Saving…" : "Save reference version"}</button>
            {sourceId && sessionId && <Link className="text-xs text-accent-soft hover:underline" href={sourceHref({ sourceId, sessionId })}>Inspect source session →</Link>}
          </div>
        </form>
      </details>

      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium">Import review observations</summary>
        <form className="mt-3" onSubmit={importObservations}>
          <label className="block text-xs text-fg-muted">Structured JSON array (or one object)
            <textarea className="analysis-input mt-1 min-h-48 w-full font-mono text-[11px]" value={observationJson} onChange={(event) => setObservationJson(event.target.value)} spellCheck={false} />
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button className="analysis-control" type="submit" disabled={saving}>{saving ? "Importing…" : "Import observations"}</button>
            <span className="text-[11px] text-fg-dim">Exact identity, rubric, method, and provenance are required.</span>
          </div>
        </form>
      </details>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="References" value={String(report?.references.total ?? 0)} detail={`${report?.references.human ?? 0} human · ${report?.references.synthetic ?? 0} synthetic`} />
        <Metric label="Matched observations" value={String(report?.observations.matched ?? 0)} detail={`${report?.observations.unmatched ?? 0} unmatched`} />
        <Metric label="Human comparisons" value={String(report?.observations.humanMatched ?? 0)} detail="synthetic observations excluded" />
        <Metric label="Synthetic fixtures" value={String(report?.observations.syntheticMatched ?? 0)} detail="reported separately" />
        <Metric label="Imported provenance" value={String(report?.observations.importedMatched ?? 0)} detail="method records labeled" />
      </div>

      {report?.methods.length ? <div className="mt-4 space-y-2" aria-label="Calibration method reports"><h3 className="text-sm font-medium">Method reports</h3><p className="text-[11px] text-fg-dim">Agreement, false-success, abstention, and citation rates use matched human references. Synthetic fixtures and imported provenance remain visible as separate counts.</p>{report.methods.map((method) => <MethodReport key={method.methodKey} method={method} />)}</div> : <p className="mt-4 rounded-md border border-bd-subtle p-3 text-xs text-fg-dim">No exact review comparisons yet. Save a reference and import an observation with the same source, session, digest, evidence version, and rubric.</p>}

      <details className="mt-4">
        <summary className="cursor-pointer text-xs font-medium">Reference and version history ({references.length})</summary>
        {references.length ? <div className="mt-2 space-y-1">{references.map((reference) => <div key={`${reference.referenceId}:${reference.version}`} className="rounded-md border border-bd-subtle p-2 text-[11px]"><div className="flex flex-wrap items-center justify-between gap-2"><span><span className="font-medium">{reference.label}</span> <span className="text-fg-dim mono">v{reference.version} · {reference.provenance} · {reference.outcome}</span></span><span className="flex items-center gap-2 text-fg-dim mono">{reference.sourceId}/{reference.sessionId}{reference.sourceId && reference.sessionId && <Link className="text-accent-soft hover:underline" href={sourceHref(reference)}>Inspect source</Link>}</span></div><details className="mt-1"><summary className="cursor-pointer text-fg-dim">Inspect immutable reference details</summary><div className="mt-2 grid gap-x-4 gap-y-1 text-[10px] text-fg-dim sm:grid-cols-2"><span>Reference ID: <b className="font-normal text-fg mono">{reference.referenceId}</b></span><span>Created: <b className="font-normal text-fg mono">{new Date(reference.createdAt).toISOString()}</b></span><span>Author: <b className="font-normal text-fg">{reference.authorLabel}</b></span><span>Digest: <b className="font-normal text-fg mono">{reference.evidenceDigest}</b></span><span>Evidence: <b className="font-normal text-fg mono">{reference.evidenceVersion}</b></span><span>Rubric: <b className="font-normal text-fg mono">{reference.rubric}</b></span><span>Citations: <b className="font-normal text-fg mono">{reference.citedEvidenceIds.length ? reference.citedEvidenceIds.join(", ") : "none"}</b></span><span className="sm:col-span-2">Rationale: <b className="font-normal text-fg">{reference.rationale}</b></span></div></details></div>)}</div> : <p className="mt-2 text-xs text-fg-dim">No references saved.</p>}
      </details>
      {report?.note && <p className="mt-3 text-[11px] leading-relaxed text-fg-dim">{report.note}</p>}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs text-fg-muted">{label}<span className="mt-1 block">{children}</span></label>;
}
