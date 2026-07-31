"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { AlertCircle, FileCode2, Loader2, ScanEye } from "lucide-react";
import ArtifactPreview from "./ArtifactPreview";
import { fetchArtifact, type ArtifactReceipt } from "./run-detail/artifact-utils";

export interface VisualComparisonStageProps {
  baseline: { id: string; name: string; status: string };
  comparison: { id: string; name: string; status: string };
  rows: Array<{
    caseId: string;
    sample: number;
    caseName: string;
    category: string;
    aCaseRef: string | null;
    bCaseRef: string | null;
    aStatus: string | null;
    bStatus: string | null;
    aVisualArtifacts: string[];
    bVisualArtifacts: string[];
  }>;
}

type CaseRow = VisualComparisonStageProps["rows"][number];
type FetchState =
  | { status: "idle" | "loading" }
  | { status: "ready"; receipt: ArtifactReceipt }
  | { status: "unavailable" | "error"; message: string };

const stageSurface: CSSProperties = {
  backgroundColor: "var(--color-bg-subtle)",
  borderColor: "var(--color-bd)",
};

const controlSurface: CSSProperties = {
  backgroundColor: "var(--color-bg)",
  borderColor: "var(--color-bd)",
  color: "var(--color-fg)",
};

const selectedControl: CSSProperties = {
  backgroundColor: "color-mix(in srgb, var(--color-accent) 14%, var(--color-bg-subtle))",
  borderColor: "color-mix(in srgb, var(--color-accent) 64%, var(--color-bd))",
  color: "var(--color-accent-soft)",
};

function caseKey(row: CaseRow) {
  return `${row.caseId}::${row.sample}`;
}

function formatBytes(bytes: number | undefined) {
  return bytes == null ? "—" : new Intl.NumberFormat("en-US").format(bytes);
}

function formatStatus(status: string) {
  if (!status) return "Unknown";
  return status.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function runStatusStyle(status: string): CSSProperties {
  const normalized = status.toLowerCase();
  if (normalized === "passed" || normalized === "completed" || normalized === "complete") {
    return {
      backgroundColor: "color-mix(in srgb, var(--color-ok) 12%, var(--color-bg-subtle))",
      borderColor: "color-mix(in srgb, var(--color-ok) 44%, var(--color-bd))",
      color: "var(--color-ok)",
    };
  }
  if (normalized === "failed" || normalized === "error") {
    return {
      backgroundColor: "color-mix(in srgb, var(--color-err) 12%, var(--color-bg-subtle))",
      borderColor: "color-mix(in srgb, var(--color-err) 44%, var(--color-bd))",
      color: "var(--color-err)",
    };
  }
  return {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 10%, var(--color-bg-subtle))",
    borderColor: "color-mix(in srgb, var(--color-accent) 34%, var(--color-bd))",
    color: "var(--color-fg-muted)",
  };
}

function RunBadge({ run, label }: { run: VisualComparisonStageProps["baseline"]; label: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-fg-dim">{label}</div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <strong className="min-w-0 truncate text-sm text-fg" title={run.name}>{run.name}</strong>
        <span
          className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
          style={runStatusStyle(run.status)}
        >
          {formatStatus(run.status)}
        </span>
      </div>
      <div className="mt-1 truncate font-mono text-[10px] text-fg-dim" title={run.id}>{run.id}</div>
    </div>
  );
}

function ArtifactReceiptLine({ receipt }: { receipt: ArtifactReceipt }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-fg-muted">
      <span className="font-medium text-fg">{formatBytes(receipt.bytes)} bytes</span>
      <code className="max-w-full truncate font-mono" title={receipt.sha256}>sha256 {receipt.sha256.slice(0, 16)}…</code>
    </div>
  );
}

function ArtifactPanel({
  label,
  run,
  artifactPath,
  state,
  onRetry,
}: {
  label: string;
  run: VisualComparisonStageProps["baseline"];
  artifactPath: string;
  state: FetchState;
  onRetry?: () => void;
}) {
  const readyReceipt = state.status === "ready" ? state.receipt : null;

  return (
    <article className="min-w-0 overflow-hidden rounded-lg border" style={stageSurface} aria-label={`${label} artifact preview`}>
      <header className="flex min-w-0 items-start justify-between gap-3 border-b px-3 py-3" style={{ borderColor: "var(--color-bd-subtle)" }}>
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-fg-dim">{label}</div>
          <div className="mt-1 truncate text-sm font-medium text-fg" title={run.name}>{run.name}</div>
        </div>
        <span className="shrink-0 rounded border px-2 py-1 font-mono text-[10px] text-fg-dim" style={{ borderColor: "var(--color-bd-subtle)" }}>
          {label === "Baseline A" ? "A" : "B"}
        </span>
      </header>

      <div className="space-y-2 p-3">
        <div className="truncate font-mono text-[10px] text-fg-dim" title={artifactPath || undefined}>
          {artifactPath || "No artifact selected"}
        </div>

        {state.status === "loading" && (
          <div className="flex min-h-[280px] items-center justify-center rounded-md border border-dashed text-sm text-fg-muted" style={{ borderColor: "var(--color-bd)" }} role="status">
            <Loader2 className="mr-2 size-4 animate-spin text-accent-soft" aria-hidden="true" />
            Loading observed artifact
          </div>
        )}

        {(state.status === "unavailable" || state.status === "error") && (
          <div className="flex min-h-[280px] flex-col items-center justify-center rounded-md border border-dashed px-6 text-center" style={{ borderColor: "var(--color-bd)" }} role="status">
            <AlertCircle className="mb-2 size-5 text-fg-dim" aria-hidden="true" />
            <div className="text-sm font-medium text-fg">{state.status === "unavailable" ? "Expected artifact not observed on this side" : "Artifact unavailable"}</div>
            <p className="mt-1 max-w-sm text-xs leading-5 text-fg-muted">{state.message}</p>
            {state.status === "error" && onRetry && (
              <button type="button" onClick={onRetry} className="mt-3 min-h-9 rounded-md border px-3 py-1.5 text-xs text-accent-soft transition-colors hover:bg-bg-elev focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" style={{ borderColor: "var(--color-bd)" }}>
                Retry artifact fetch
              </button>
            )}
          </div>
        )}

        {readyReceipt && (
          <>
            <div className="rounded-md border px-3 py-2" style={{ backgroundColor: "color-mix(in srgb, var(--color-bg-elev) 56%, var(--color-bg-subtle))", borderColor: "var(--color-bd-subtle)" }}>
              <ArtifactReceiptLine receipt={readyReceipt} />
            </div>
            <div className="overflow-hidden rounded-md" style={{ backgroundColor: "#ffffff" }}>
              <ArtifactPreview path={readyReceipt.path} content={readyReceipt.content} />
            </div>
          </>
        )}
      </div>
    </article>
  );
}

function ByteReceipt({ a, b }: { a: FetchState; b: FetchState }) {
  const aReceipt = a.status === "ready" ? a.receipt : null;
  const bReceipt = b.status === "ready" ? b.receipt : null;
  const hashesMatch = aReceipt && bReceipt && aReceipt.sha256 === bReceipt.sha256;

  return (
    <section className="rounded-lg border px-3 py-3" style={{ backgroundColor: "color-mix(in srgb, var(--color-bg-elev) 42%, var(--color-bg-subtle))", borderColor: "var(--color-bd)" }} aria-label="Byte receipt">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold text-fg">Byte receipt</h3>
        <span className="text-[10px] uppercase tracking-[0.12em] text-fg-dim">File metadata only</span>
      </div>
      <div className="mt-2 grid gap-2 text-[11px] sm:grid-cols-3">
        <div>
          <div className="text-fg-dim">Baseline A</div>
          <div className="mt-0.5 font-mono text-fg">{formatBytes(aReceipt?.bytes)} bytes</div>
        </div>
        <div>
          <div className="text-fg-dim">Comparison B</div>
          <div className="mt-0.5 font-mono text-fg">{formatBytes(bReceipt?.bytes)} bytes</div>
        </div>
        <div className="min-w-0">
          <div className="text-fg-dim">SHA-256 relation</div>
          <div className="mt-0.5 truncate font-mono text-fg" title={aReceipt && bReceipt ? `${aReceipt.sha256} / ${bReceipt.sha256}` : undefined}>
            {hashesMatch == null ? "Waiting for both receipts" : hashesMatch ? "Same hash" : "Different hashes"}
          </div>
        </div>
      </div>
      <p className="mt-2 text-[10px] leading-4 text-fg-muted">This receipt describes file bytes and hashes. Visual quality is not verified, and no visual pass/fail is inferred.</p>
    </section>
  );
}

export default function VisualComparisonStage({ baseline, comparison, rows }: VisualComparisonStageProps) {
  const [selectedCaseKey, setSelectedCaseKey] = useState(() => (rows[0] ? caseKey(rows[0]) : ""));
  const [selectedArtifact, setSelectedArtifact] = useState("");
  const [retryToken, setRetryToken] = useState(0);
  const [artifactStates, setArtifactStates] = useState<{ a: FetchState; b: FetchState }>({ a: { status: "idle" }, b: { status: "idle" } });

  const selectedRow = useMemo(() => rows.find((row) => caseKey(row) === selectedCaseKey) ?? rows[0] ?? null, [rows, selectedCaseKey]);
  const artifactOptions = useMemo(() => {
    if (!selectedRow) return [];
    return [...new Set([...selectedRow.aVisualArtifacts, ...selectedRow.bVisualArtifacts])].sort((a, b) => a.localeCompare(b));
  }, [selectedRow]);

  useEffect(() => {
    const nextKey = rows[0] ? caseKey(rows[0]) : "";
    if (!rows.some((row) => caseKey(row) === selectedCaseKey)) setSelectedCaseKey(nextKey);
  }, [rows, selectedCaseKey]);

  useEffect(() => {
    setSelectedArtifact((current) => artifactOptions.includes(current) ? current : artifactOptions[0] ?? "");
  }, [artifactOptions]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedRow || !selectedArtifact) {
      setArtifactStates({
        a: { status: "unavailable", message: "No visual artifact is declared for this case." },
        b: { status: "unavailable", message: "No visual artifact is declared for this case." },
      });
      return () => { cancelled = true; };
    }

    const load = async (runId: string, caseRef: string | null, declaredArtifacts: string[]): Promise<FetchState> => {
      if (!declaredArtifacts.includes(selectedArtifact)) {
        return { status: "unavailable", message: "The selected path is not declared on this run." };
      }
      if (!caseRef) {
        return { status: "unavailable", message: "This side has no unique case record for the selected sample." };
      }
      try {
        return { status: "ready", receipt: await fetchArtifact(runId, caseRef, selectedArtifact) };
      } catch (error) {
        return { status: "error", message: error instanceof Error ? error.message : "The artifact could not be fetched." };
      }
    };

    setArtifactStates({ a: { status: "loading" }, b: { status: "loading" } });
    Promise.all([
      load(baseline.id, selectedRow.aCaseRef, selectedRow.aVisualArtifacts),
      load(comparison.id, selectedRow.bCaseRef, selectedRow.bVisualArtifacts),
    ]).then(([a, b]) => {
      if (!cancelled) setArtifactStates({ a, b });
    });

    return () => { cancelled = true; };
  }, [baseline.id, comparison.id, retryToken, selectedArtifact, selectedRow]);

  if (!rows.length) {
    return (
      <section className="card overflow-hidden" aria-labelledby="visual-comparison-title">
        <div className="flex items-center gap-3 border-b px-4 py-4" style={{ borderColor: "var(--color-bd-subtle)" }}>
          <ScanEye className="size-5 text-accent-soft" aria-hidden="true" />
          <div>
            <h2 id="visual-comparison-title" className="text-sm font-semibold text-fg">Visual comparison</h2>
            <p className="mt-1 text-xs text-fg-muted">No comparable visual cases are available for these runs.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="card overflow-hidden" aria-labelledby="visual-comparison-title" aria-busy={artifactStates.a.status === "loading" || artifactStates.b.status === "loading"}>
      <header className="border-b px-4 py-4 md:px-5" style={{ borderColor: "var(--color-bd-subtle)" }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <ScanEye className="mt-0.5 size-5 shrink-0 text-accent-soft" aria-hidden="true" />
            <div className="min-w-0">
              <h2 id="visual-comparison-title" className="text-sm font-semibold text-fg">Visual comparison</h2>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-fg-muted">Inspect the same declared artifact on both runs. Each preview is rendered independently in the existing sandbox.</p>
            </div>
          </div>
          <div className="rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-fg-muted" style={{ borderColor: "var(--color-bd)" }}>
            Side-by-side
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <RunBadge label="Baseline A" run={baseline} />
          <RunBadge label="Comparison B" run={comparison} />
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div>
            <label htmlFor="visual-comparison-case" className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.14em] text-fg-dim">Visual case</label>
            <select
              id="visual-comparison-case"
              value={selectedRow ? caseKey(selectedRow) : ""}
              onChange={(event) => setSelectedCaseKey(event.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm outline-none"
              style={controlSurface}
            >
              {rows.map((row) => (
                <option key={caseKey(row)} value={caseKey(row)}>
                  {row.caseName} · sample {row.sample}{row.category ? ` · ${row.category}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-fg-dim">Artifact</div>
            {artifactOptions.length ? (
              <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto" role="group" aria-label="Artifact selector">
                {artifactOptions.map((artifact) => {
                  const selected = artifact === selectedArtifact;
                  return (
                    <button
                      key={artifact}
                      type="button"
                      onClick={() => setSelectedArtifact(artifact)}
                      aria-pressed={selected}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-md border px-2.5 py-2 text-left font-mono text-[11px] transition-colors hover:border-accent-soft focus-visible:outline-none"
                      style={selected ? selectedControl : controlSurface}
                      title={artifact}
                    >
                      <FileCode2 className="size-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{artifact}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-md border border-dashed px-3 py-2 text-xs text-fg-muted" style={{ borderColor: "var(--color-bd)" }}>No visual artifact declared for this case.</div>
            )}
          </div>
        </div>
      </header>

      <div className="space-y-3 p-3 md:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-[0.14em] text-fg-dim">Selected case · {selectedRow?.caseId} · sample {selectedRow?.sample}</div>
          <div className="text-[10px] text-fg-muted">No overlay or diff mode is implied; this stage provides working side-by-side inspection.</div>
        </div>
        <div className="grid min-w-0 gap-3 xl:grid-cols-2">
          <ArtifactPanel label="Baseline A" run={baseline} artifactPath={selectedArtifact} state={artifactStates.a} onRetry={() => setRetryToken((value) => value + 1)} />
          <ArtifactPanel label="Comparison B" run={comparison} artifactPath={selectedArtifact} state={artifactStates.b} onRetry={() => setRetryToken((value) => value + 1)} />
        </div>
        <ByteReceipt a={artifactStates.a} b={artifactStates.b} />
      </div>
    </section>
  );
}
