"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ExperimentCaseSnapshot, ExperimentSourceState, ExperimentSummary, SavedExperiment } from "@/lib/experiments";

interface SharedCohortRow {
  caseId: string;
  sample: number;
  caseName: string;
  aStatus: string | null;
  bStatus: string | null;
}

interface Props {
  baselineRunId: string;
  candidateRunId: string;
  baselineName: string;
  candidateName: string;
  sharedCohort: SharedCohortRow[];
}

function stateClass(state: ExperimentSourceState) {
  return state.status === "available" ? "text-ok" : state.status === "changed" ? "text-warn" : "text-err";
}
function stateText(state: ExperimentSourceState) {
  if (state.status === "available") return "source unchanged";
  if (state.status === "changed") return state.missingPairs.length ? `source changed · ${state.missingPairs.length} selected pair(s) unavailable` : "source changed; saved snapshot retained";
  return "source unavailable; saved snapshot retained";
}
function fmtDelta(a: number | null, b: number | null, digits = 0) { return a === null || b === null ? "—" : `${b - a >= 0 ? "+" : ""}${(b - a).toFixed(digits)}`; }
function pairKey(row: { caseId: string; sample: number }) { return `${row.caseId}\u0000${row.sample}`; }
function methodSummary(row: ExperimentCaseSnapshot | null) { return row?.grading.methods.length ? row.grading.methods.map((method) => `${method.type}${method.judgeReceipt ? `/${(method.judgeReceipt as { status?: string }).status ?? "judge"}` : ""}`).join(", ") : "no retained grader methods"; }

export default function ExperimentPanel({ baselineRunId, candidateRunId, baselineName, candidateName, sharedCohort }: Props) {
  const [hypothesis, setHypothesis] = useState("");
  const [originSourceId, setOriginSourceId] = useState("");
  const [originSessionId, setOriginSessionId] = useState("");
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [selected, setSelected] = useState<SavedExperiment | null>(null);
  const [lookupId, setLookupId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loadToken = useRef(0);
  const visibleCohortKey = sharedCohort.map(pairKey).join("|");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  useEffect(() => { setSelectedKeys(new Set(visibleCohortKey ? visibleCohortKey.split("|") : [])); }, [visibleCohortKey]);
  const selectedCohort = sharedCohort.filter((row) => selectedKeys.has(pairKey(row)));

  const loadList = async () => {
    const response = await fetch("/api/experiments?limit=50", { cache: "no-store" });
    if (!response.ok) throw new Error("Saved experiments could not be loaded.");
    const body = await response.json() as { experiments?: ExperimentSummary[] };
    setExperiments(body.experiments ?? []);
  };
  const loadExperiment = async (id: string, pushUrl = true) => {
    const trimmed = id.trim();
    if (!trimmed) return;
    const token = ++loadToken.current;
    setLoading(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/experiments?id=${encodeURIComponent(trimmed)}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as { experiment?: SavedExperiment; detail?: string; message?: string };
      if (!response.ok || !body.experiment) throw new Error(body.detail || body.message || "Saved experiment could not be loaded.");
      if (token !== loadToken.current) return;
      setSelected(body.experiment); setLookupId(body.experiment.experimentId); setHypothesis(body.experiment.hypothesis);
      if (pushUrl) { const url = new URL(window.location.href); url.searchParams.set("experiment", body.experiment.experimentId); window.history.pushState(null, "", url); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Saved experiment could not be loaded."); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    let cancelled = false;
    void loadList().catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Saved experiments could not be loaded."); });
    const params = new URLSearchParams(window.location.search);
    const id = params.get("experiment");
    if (id) void loadExperiment(id, false);
    const restore = () => {
      const next = new URLSearchParams(window.location.search).get("experiment");
      if (next) void loadExperiment(next, false);
      else { ++loadToken.current; setSelected(null); setLookupId(""); }
    };
    window.addEventListener("popstate", restore);
    return () => { cancelled = true; window.removeEventListener("popstate", restore); };
  }, []);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true); setError(null); setNotice(null);
    try {
      if (!baselineRunId || !candidateRunId || baselineRunId === candidateRunId) throw new Error("Choose two different completed runs before saving an experiment.");
      if (selectedCohort.length === 0) throw new Error("Select at least one shared case/sample pair before saving.");
      const response = await fetch("/api/experiments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        hypothesis,
        baselineRunId,
        candidateRunId,
        cohort: selectedCohort.map((row) => ({ caseId: row.caseId, sample: row.sample })),
        originSourceId: originSourceId.trim() || null,
        originSessionId: originSessionId.trim() || null,
      }) });
      const body = await response.json().catch(() => ({})) as { experiment?: SavedExperiment; detail?: string; message?: string };
      if (!response.ok || !body.experiment) throw new Error(body.detail || body.message || "Experiment could not be saved.");
      setSelected(body.experiment); setLookupId(body.experiment.experimentId); setNotice(`Saved ${body.experiment.cohort.length} exact case/sample pairs as ${body.experiment.experimentId}.`);
      const url = new URL(window.location.href); url.searchParams.set("experiment", body.experiment.experimentId); window.history.pushState(null, "", url);
      await loadList();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Experiment could not be saved."); }
    finally { setSaving(false); }
  };

  const selectedRows = useMemo(() => {
    if (!selected) return [];
    const baseline = new Map(selected.baseline.cases.map((row) => [pairKey({ caseId: row.caseId, sample: row.sample }), row]));
    const candidate = new Map(selected.candidate.cases.map((row) => [pairKey({ caseId: row.caseId, sample: row.sample }), row]));
    return selected.cohort.map((pair) => ({ pair, baseline: baseline.get(pairKey(pair)) ?? null, candidate: candidate.get(pairKey(pair)) ?? null }));
  }, [selected]);

  return (
    <section className="card mb-4 p-4" aria-labelledby="experiment-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-accent-soft">Saved experiment</div>
          <h2 id="experiment-title" className="mt-1 text-base font-medium">Pair a baseline with a candidate</h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-fg-muted">Save a hypothesis and the exact shared case/sample cohort currently visible below. The server freezes run configuration, judge metadata, and paired results; it does not launch another run or claim causation.</p>
        </div>
        {loading && <span className="text-[11px] text-fg-dim mono">Loading saved experiment…</span>}
      </div>
      {error && <div className="mt-3 rounded-md border border-err p-2.5 text-xs text-err" role="alert">{error}</div>}
      {notice && <div className="mt-3 rounded-md border border-ok p-2.5 text-xs text-ok" role="status">{notice}</div>}

      <form className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" onSubmit={save}>
        <label className="block text-xs text-fg-muted md:col-span-2">Hypothesis<input className="analysis-input mt-1 w-full" required value={hypothesis} onChange={(event) => setHypothesis(event.target.value)} placeholder="e.g. candidate reduces tool errors on the shared cohort" /></label>
        <label className="block text-xs text-fg-muted">Origin source ID (optional)<input className="analysis-input mt-1 w-full" value={originSourceId} onChange={(event) => setOriginSourceId(event.target.value)} /></label>
        <label className="block text-xs text-fg-muted">Origin session ID (optional)<input className="analysis-input mt-1 w-full" value={originSessionId} onChange={(event) => setOriginSessionId(event.target.value)} /></label>
        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <button className="analysis-control" type="submit" disabled={saving || selectedCohort.length === 0 || !baselineRunId || !candidateRunId}>{saving ? "Saving…" : `Save ${selectedCohort.length} selected pair${selectedCohort.length === 1 ? "" : "s"}`}</button>
          <span className="text-[11px] text-fg-dim mono">A: {baselineName || baselineRunId} · B: {candidateName || candidateRunId}</span>
        </div>
      </form>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium">Choose cohort ({selectedCohort.length} selected of {sharedCohort.length} visible shared pairs)</summary>
        <div className="mt-2 flex flex-wrap gap-2"><button type="button" className="analysis-control" onClick={() => setSelectedKeys(new Set(sharedCohort.map(pairKey)))}>Select all visible</button><button type="button" className="analysis-control" onClick={() => setSelectedKeys(new Set())}>Clear selection</button></div>
        <div className="mt-2 max-h-56 overflow-y-auto space-y-1">{sharedCohort.map((row) => <label key={pairKey(row)} className="flex items-center gap-2 rounded-md border border-bd-subtle p-2 text-[11px] hover:bg-bg-elev"><input type="checkbox" checked={selectedKeys.has(pairKey(row))} onChange={() => setSelectedKeys((current) => { const next = new Set(current); const key = pairKey(row); if (next.has(key)) next.delete(key); else next.add(key); return next; })} /><span className="mono">{row.caseName} · {row.caseId} · sample {row.sample}</span><span className="ml-auto text-fg-dim">{row.aStatus ?? "missing"} → {row.bStatus ?? "missing"}</span></label>)}{sharedCohort.length === 0 && <p className="text-xs text-fg-dim">Choose two runs with at least one shared case/sample pair.</p>}</div>
      </details>

      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium">Saved experiments ({experiments.length} latest)</summary>
        <div className="mt-3 flex flex-wrap gap-2">
          <input className="analysis-input min-w-[220px] flex-1 font-mono text-xs" value={lookupId} onChange={(event) => setLookupId(event.target.value)} placeholder="Paste any saved experiment ID" />
          <button className="analysis-control" type="button" onClick={() => void loadExperiment(lookupId)}>Open ID</button>
        </div>
        {experiments.length ? <div className="mt-3 space-y-1">{experiments.map((item) => <button key={item.experimentId} type="button" className="block w-full rounded-md border border-bd-subtle p-2 text-left hover:bg-bg-elev" onClick={() => void loadExperiment(item.experimentId)}><span className="text-xs font-medium">{item.hypothesis}</span><span className="mt-0.5 block text-[10px] text-fg-dim mono">{item.experimentId} · {item.baselineRunId} → {item.candidateRunId} · {item.cohortCount} pairs</span></button>)}</div> : <p className="mt-3 text-xs text-fg-dim">No saved experiments yet.</p>}
      </details>

      {selected && <SavedDetails experiment={selected} rows={selectedRows} />}
    </section>
  );
}

function SavedDetails({ experiment, rows }: { experiment: SavedExperiment; rows: Array<{ pair: { caseId: string; sample: number }; baseline: ExperimentCaseSnapshot | null; candidate: ExperimentCaseSnapshot | null }> }) {
  const [showAll, setShowAll] = useState(false);
  const compareHref = `/runs/compare?a=${encodeURIComponent(experiment.baselineRunId)}&b=${encodeURIComponent(experiment.candidateRunId)}&experiment=${encodeURIComponent(experiment.experimentId)}`;
  return (
    <div className="mt-4 border-t border-bd-subtle pt-4" aria-label="Saved experiment details">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-medium">{experiment.hypothesis}</h3><p className="mt-1 text-[11px] text-fg-dim mono">{experiment.experimentId} · {experiment.cohort.length} frozen pairs · digest {experiment.cohortDigest.slice(0, 12)}…</p></div><Link className="text-xs text-accent-soft hover:underline" href={compareHref}>Open live comparison →</Link></div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2"><SourceSummary label="Baseline" runId={experiment.baselineRunId} snapshot={experiment.baseline} state={experiment.sourceStates.baseline} /><SourceSummary label="Candidate" runId={experiment.candidateRunId} snapshot={experiment.candidate} state={experiment.sourceStates.candidate} /></div>
      <details className="mt-3"><summary className="cursor-pointer text-xs font-medium">Frozen configuration and judge metadata</summary><div className="mt-2 grid gap-2 sm:grid-cols-2"><SnapshotMeta label="Baseline" snapshot={experiment.baseline} /><SnapshotMeta label="Candidate" snapshot={experiment.candidate} /></div></details>
      <details className="mt-3"><summary className="cursor-pointer text-xs font-medium">Frozen paired results ({rows.length})</summary><div className="mt-2 space-y-1">{rows.slice(0, showAll ? rows.length : 30).map((row) => <div key={pairKey(row.pair)} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-bd-subtle p-2 text-[11px]"><span className="mono">{row.pair.caseId} · sample {row.pair.sample}</span><span className="text-fg-dim">{row.baseline?.status ?? "missing"} → {row.candidate?.status ?? "missing"} · output Δ {fmtDelta(row.baseline?.runner.outputTokens ?? null, row.candidate?.runner.outputTokens ?? null)} · cost Δ {fmtDelta(row.baseline?.runner.costUsd ?? null, row.candidate?.runner.costUsd ?? null, 4)} · time Δ {fmtDelta(row.baseline?.runner.durationMs ?? null, row.candidate?.runner.durationMs ?? null)} · {methodSummary(row.baseline)} → {methodSummary(row.candidate)}</span></div>)}{rows.length > 30 && <button type="button" className="analysis-control mt-1" onClick={() => setShowAll((value) => !value)}>{showAll ? "Show first 30" : `Show all ${rows.length} frozen pairs`}</button>}</div></details>
    </div>
  );
}

function SourceSummary({ label, runId, snapshot, state }: { label: string; runId: string; snapshot: SavedExperiment["baseline"]; state: ExperimentSourceState }) {
  return <div className="rounded-md border border-bd-subtle p-3"><div className="flex flex-wrap justify-between gap-2"><span className="text-xs font-medium">{label}: {snapshot.name}</span><span className={`text-[10px] ${stateClass(state)}`}>{stateText(state)}</span></div><div className="mt-1 text-[10px] text-fg-dim mono">run {runId} · saved {new Date(snapshot.createdAt).toISOString()} · {snapshot.cases.length} retained cases</div></div>;
}

function SnapshotMeta({ label, snapshot }: { label: string; snapshot: SavedExperiment["baseline"] }) {
  const methods = [...new Set(snapshot.cases.flatMap((row) => row.grading.methods.map((method) => method.type)))];
  return <div className="rounded-md border border-bd-subtle p-2 text-[10px] text-fg-dim"><div className="font-medium text-fg">{label}</div><div className="mt-1 mono">runner {snapshot.configuration.runner} · harness {snapshot.configuration.harness ?? "—"} · model {snapshot.configuration.model ?? "—"} · parallel {snapshot.configuration.parallel} · samples {snapshot.configuration.samples ?? "—"}</div><div className="mt-1">Filter: <span className="mono">{snapshot.configuration.filter ? JSON.stringify(snapshot.configuration.filter) : "all"}</span></div><div className="mt-1">Judge: <span className="mono">{snapshot.judge ? JSON.stringify(snapshot.judge) : "unavailable"}</span></div><div className="mt-1">Retained grader methods: <span className="mono">{methods.length ? methods.join(", ") : "unavailable"}</span></div></div>;
}
