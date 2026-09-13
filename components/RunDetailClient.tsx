"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MetricDistribution } from "./charts/MetricDistribution";
import TelemetryStrip from "./TelemetryStrip";
import RunTimeline from "./RunTimeline";
import { RunStatusChart } from "./run-detail/RunStatusChart";
import RunWatch from "./RunWatch";
import { CircleDot } from "lucide-react";
import type { RunCaseRecord } from "@/lib/types";
import { exportCsv, exportJson } from "@/lib/export";
import { useVisibilityPoll } from "@/lib/use-visibility-poll";
import { useRunEvents } from "@/lib/use-run-events";
import RunHero, { type CancelPhase } from "./run-detail/RunHero";
import RunConfidencePanel from "./run-detail/RunConfidencePanel";
import CaseListPanel from "./run-detail/CaseListPanel";
import CaseSidePanel from "./run-detail/CaseSidePanel";
import { summarizeRunConfidence } from "./run-detail/trust";
import { useCollapsedSections } from "./run-detail/collapse";
import type { JudgeSelection } from "@/lib/grader/selection";

interface Props { runId: string; runName?: string; initialCases: RunCaseRecord[]; running: boolean; createdAt?: number; endedAt?: number | null; model?: string; harness?: string; judge?: JudgeSelection; harnessInfo?: { id: string; bin: string | null; version: string | null }; }

export default function RunDetailClient({ runId, runName, initialCases, running, createdAt, endedAt, model, harness, judge, harnessInfo }: Props) {
  const [cases, setCases] = useState<RunCaseRecord[]>(initialCases);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(initialCases.length ? 0 : null);
  const selectCase = (index: number) => {
    setSelectedIdx(index);
    const item = cases[index]; if (!item) return;
    const url = new URL(window.location.href); url.searchParams.set("selectedCase", item.id);
    window.history.pushState(null, "", url);
    if (window.matchMedia("(max-width: 1023px)").matches) requestAnimationFrame(() => document.getElementById("run-case-evidence")?.scrollIntoView({ block: "start" }));
  };
  useEffect(() => {
    const restore = () => { const id = new URLSearchParams(window.location.search).get("selectedCase"); if (id) { const index = cases.findIndex((item) => item.id === id); setSelectedIdx(index >= 0 ? index : null); } else setSelectedIdx(cases.length ? 0 : null); };
    restore(); window.addEventListener("popstate", restore); return () => window.removeEventListener("popstate", restore);
  }, [cases]);
  const [live, setLive] = useState(running);
  const [cancelPhase, setCancelPhase] = useState<CancelPhase>("idle");
  const { collapsed, toggle } = useCollapsedSections(runId);

  async function cancelRun() {
    if (cancelPhase !== "idle") return;
    setCancelPhase("cancelling");
    try {
      const res = await fetch(`/api/runs/${runId}/cancel`, { method: "POST" });
      if (!res.ok) throw new Error("cancel failed");
      // Optimistic: the server marked the run aborted; in-flight cases still
      // finish naturally and land via the final refetch.
      setCancelPhase("cancelled");
      await refetchLite(true, true);
      setLive(false);
    } catch {
      setCancelPhase("idle");
    }
  }

  const fetchInFlight = useRef<Promise<void> | null>(null);
  const fetchInFlightToken = useRef<object | null>(null);
  const refetchLite = useCallback(async (finalize = false, force = false) => {
    if (fetchInFlight.current && !force) return fetchInFlight.current;
    if (fetchInFlight.current && force) await fetchInFlight.current.catch(() => {});
    const requestToken = {};
    const request = (async () => {
      try {
        const res = await fetch(`/api/runs/${runId}?lite=1`).then((r) => r.json());
        if (res.cases) setCases(res.cases);
        if (res.run?.status !== "running" && !finalize) setLive(false);
      } catch {
        // transient
      } finally {
        if (fetchInFlightToken.current === requestToken) {
          fetchInFlight.current = null;
          fetchInFlightToken.current = null;
        }
      }
    })();
    fetchInFlightToken.current = requestToken;
    fetchInFlight.current = request;
    return request;
  }, [runId]);

  // SSE-driven refetch: case state transitions invalidate the lite snapshot.
  const runEvents = useRunEvents(runId, {
    // Keep the stream enabled after completion so settled runs can replay a
    // bounded recent-activity buffer once, then close on their terminal event.
    enabled: true,
    onEvent: (ev) => {
      if (ev.kind === "case_started" || ev.kind === "case_grading" || ev.kind === "case_finished" || ev.kind === "case_error" || ev.kind === "grader_result") {
        refetchLite();
      } else if (ev.kind === "run_completed" || ev.kind === "run_fatal" || ev.kind === "run_aborted" || ev.kind === "run_stream_closed") {
        void refetchLite(true, true).finally(() => setLive(false));
      }
    },
  });

  // Fallback poll in case SSE stalls — every 8s when live, visibility-aware.
  useVisibilityPoll(refetchLite, 8000, [runId], live);

  const counts = {
    passed: cases.filter((c) => c.status === "passed").length,
    failed: cases.filter((c) => c.status === "failed").length,
    error: cases.filter((c) => c.status === "error").length,
    skipped: cases.filter((c) => c.status === "skipped").length,
    running: cases.filter((c) => c.status === "running" || c.status === "grading").length,
    pending: cases.filter((c) => c.status === "pending").length,
  };
  const passRatio = cases.length ? Math.round((counts.passed / cases.length) * 100) : 0;
  const visualCases = cases.filter((c) => c.case_def?.visual?.expected_artifacts?.length);
  const activeCase = selectedIdx === null ? null : cases[selectedIdx] ?? null;
  const confidence = summarizeRunConfidence(cases);

  function exportCaseCsv() {
    exportCsv(`openeval-${runId}-cases.csv`, cases.map((c) => ({
      case_id: c.case_id,
      case_name: c.case_name,
      category: c.category,
      difficulty: c.difficulty ?? "",
      status: c.status,
      score: c.evaluation?.passRatio ?? "",
      duration_ms: c.evaluation?.durationMs ?? "",
      budget_exceeded: c.budget_exceeded ?? false,
      error: c.error_msg ?? "",
    })));
  }

  function exportRunJson() {
    exportJson(`openeval-${runId}.json`, {
      run_id: runId,
      run_name: runName ?? "Run output",
      harness: harness ?? null,
      model: model ?? null,
      judge: judge ?? null,
      cases,
    });
  }

  return (
    <div>
      <RunHero
        runId={runId}
        runName={runName}
        model={model}
        harness={harness}
        harnessInfo={harnessInfo}
        judge={judge}
        live={live}
        cancelPhase={cancelPhase}
        onCancel={cancelRun}
        counts={counts}
        totalCases={cases.length}
        visualCount={visualCases.length}
        onExportCsv={exportCaseCsv}
        onExportJson={exportRunJson}
      />

      <RunWatch
        runId={runId}
        createdAt={createdAt}
        endedAt={endedAt}
        cases={cases}
        live={live}
        streamStatus={runEvents.status}
        events={runEvents.events}
        selectedIdx={selectedIdx}
        onSelect={selectCase}
      />

      <RunStatusChart cases={cases} onSelect={selectCase} />
      <details className="card p-4 mb-4"><summary className="cursor-pointer text-sm font-medium">Case duration and cost distributions</summary><div className="grid md:grid-cols-2 gap-3 mt-3 analysis-reveal">
        <MetricDistribution title="Case duration" values={cases.map(item => item.runner_result?.durationMs)} format={value => `${(value / 1000).toFixed(1)}s`} unit="Seconds per case/sample" description="Each recorded case/sample result contributes one duration; missing results remain excluded." />
        <MetricDistribution title="Case cost" values={cases.map(item => item.runner_result?.usage.costSource === "measured" || item.runner_result?.usage.costSource === "inferred" ? item.runner_result.usage.costUsd : null)} format={value => `$${value.toFixed(4)}`} unit="USD · measured and inferred" description="Missing and unspecified cost provenance is excluded, including legacy results without a source." />
      </div></details>
      <TelemetryStrip runId={runId} />
      {cases.length > 0 && (
        <RunTimeline
          cases={cases}
          selectedIndex={selectedIdx}
          onSelect={selectCase}
          live={live}
        />
      )}

      <RunConfidencePanel confidence={confidence} />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-4">
        <CaseListPanel
          cases={cases}
          counts={counts}
          passRatio={passRatio}
          live={live}
          selectedIdx={selectedIdx}
          onSelect={selectCase}
          model={model}
        />

        <section id="run-case-evidence" className="min-w-0 scroll-mt-16">
          {selectedIdx === null || !activeCase ? (
            <div className="card p-12 text-center border-dashed">
              <CircleDot className="size-10 text-fg-dim mx-auto mb-3 opacity-50" />
              <div className="text-sm text-fg-muted">Select a case to view details</div>
              <div className="text-[11px] text-fg-dim mt-1">Press <kbd className="px-1 py-0.5 rounded bg-bg-elev text-fg-muted text-[10px]">/</kbd> to search cases</div>
            </div>
          ) : (
            <CaseSidePanel
              key={activeCase.id}
              rc={activeCase}
              runId={runId}
              collapsed={collapsed}
              onToggleSection={toggle}
            />
          )}
        </section>
      </div>
    </div>
  );
}
