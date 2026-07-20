"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Play, Check, Filter, Search, History, AlertCircle, AlertTriangle } from "lucide-react";
import clsx from "clsx";
import type { CaseDefinition } from "@/lib/types";
import type { DiscoveredHarness } from "@/lib/adapters/discover";
import { useFocusOnSlash } from "@/lib/use-focus-slash";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import ModelPicker from "./ModelPicker";
import HarnessPicker from "./HarnessPicker";
import { readRunDefaults } from "./SettingsClient";
import { buildRunSentence, inferErrorField, isRunField, parseBoundedInt, type RunField } from "./newRunValidation";

interface Props { cases: CaseDefinition[]; initialCaseIds?: string[]; }

const CATEGORIES = ["agentic-swe", "single-tool", "reasoning", "visual-code"] as const;

type FieldErrors = Partial<Record<RunField | "general", string>>;

export default function NewRunClient({ cases, initialCaseIds = [] }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [runner, setRunner] = useState<"headless" | "tmux">("headless");
  // Seed from URL params so "Re-run selected" links keep the original harness/model.
  const [harness, setHarness] = useState<string | undefined>(() => searchParams.get("harness") ?? undefined);
  const [parallelRaw, setParallelRaw] = useState("1");
  const [samplesRaw, setSamplesRaw] = useState("1");
  const [name, setName] = useState("");
  const [model, setModel] = useState<string | undefined>(() => searchParams.get("model") ?? undefined);
  const [selected, setSelected] = useState<Record<string, boolean>>(() => Object.fromEntries(initialCaseIds.map((id) => [id, true])));
  const [filterCats, setFilterCats] = useState<Set<string>>(new Set(cases.map((c) => c.category)));
  const [filterDiff, setFilterDiff] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Discovery results power the harness field's inline validation and the
  // summary label. Fed by HarnessPicker's onDiscovered so a "Re-probe PATH"
  // there updates this validation too — no second stale copy.
  const [harnessInfo, setHarnessInfo] = useState<{ harnesses: DiscoveredHarness[]; defaultHarness: string } | null>(null);

  // Most recent stored run, for the "Repeat last run" prefill.
  const [lastRun, setLastRun] = useState<{ id: string; name: string } | null | undefined>(undefined);
  const [prefilling, setPrefilling] = useState(false);
  const [prefillNote, setPrefillNote] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/runs")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (alive) setLastRun(d.runs?.[0] ?? null); })
      .catch(() => { if (alive) setLastRun(null); });
    return () => { alive = false; };
  }, []);

  // Saved Settings-page run defaults, applied after mount (localStorage is
  // client-only; a lazy initializer would desync SSR hydration). Explicit URL
  // params — re-run links — always win.
  useEffect(() => {
    const d = readRunDefaults();
    if (d.defaultHarness && !searchParams.get("harness")) setHarness(d.defaultHarness);
    if (d.defaultModel && !searchParams.get("model")) setModel(d.defaultModel);
    if (d.defaultParallel >= 1 && d.defaultParallel <= 8) setParallelRaw(String(d.defaultParallel));
    if (d.defaultSamples >= 1 && d.defaultSamples <= 8) setSamplesRaw(String(d.defaultSamples));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allTags = Array.from(new Set(cases.flatMap((c) => c.tags ?? []))).sort();
  const [filterTags, setFilterTags] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 200);
  const searchRef = useRef<HTMLInputElement>(null);
  useFocusOnSlash(searchRef);

  const visible = cases.filter((c) => {
    if (!filterCats.has(c.category)) return false;
    if (filterDiff.size && !filterDiff.has(c.difficulty || "untiered")) return false;
    if (filterTags.size && !(c.tags ?? []).some((t) => filterTags.has(t))) return false;
    const q = debouncedSearch.trim().toLowerCase();
    if (q) {
      const hay = `${c.name} ${c.id} ${c.description ?? ""} ${(c.tags ?? []).join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const allSelected = visible.length > 0 && visible.every((c) => selected[c.id]);
  const selectedCount = Object.values(selected).filter(Boolean).length;
  const plannedCaseCount = selectedCount > 0 ? selectedCount : visible.length;

  // ── Inline validation (mirrors app/api/runs POST rules; the API 400 is a backstop) ──
  const parallelParsed = parseBoundedInt(parallelRaw);
  const samplesParsed = parseBoundedInt(samplesRaw);
  const selectedHarness = harness ? harnessInfo?.harnesses.find((h) => h.id === harness) : undefined;
  const harnessIssue: { level: "error" | "warn"; message: string } | null =
    !harness || !harnessInfo ? null
    : !selectedHarness ? { level: "error", message: `"${harness}" is not a registered harness — the API will reject it. Pick one from the list.` }
    : selectedHarness.status === "not_found" ? { level: "error", message: selectedHarness.detail || "Binary not found on PATH — install it before running." }
    : selectedHarness.status === "error" ? { level: "warn", message: selectedHarness.detail || "Probe failed — the binary resolved but did not respond; the run may error." }
    : null;

  const blockers: { field: string; message: string }[] = [];
  if (parallelParsed.error) blockers.push({ field: "parallel", message: `Parallel workers: ${parallelParsed.error}` });
  if (samplesParsed.error) blockers.push({ field: "samples", message: `Samples: ${samplesParsed.error}` });
  if (plannedCaseCount === 0) blockers.push({ field: "caseIds", message: "No cases to run — select cases or widen the filters." });
  if (harnessIssue?.level === "error") blockers.push({ field: "harness", message: `Harness: ${harnessIssue.message}` });
  const canSubmit = !submitting && blockers.length === 0;

  const totalRuns = samplesParsed.value != null ? plannedCaseCount * samplesParsed.value : null;
  const harnessLabel = harness
    ? (selectedHarness?.label || harness)
    : `default${harnessInfo?.defaultHarness ? ` (${harnessInfo.defaultHarness})` : ""}`;
  const sentence = buildRunSentence({
    caseCount: plannedCaseCount,
    samples: samplesParsed.value,
    parallel: parallelParsed.value,
    harnessLabel,
    modelLabel: model || "default model",
  });

  function toggleAll() {
    const next = { ...selected };
    for (const c of visible) next[c.id] = !allSelected;
    setSelected(next);
  }

  function toggleCat(c: string) {
    const next = new Set(filterCats);
    if (next.has(c)) next.delete(c); else next.add(c);
    setFilterCats(next);
  }

  function toggleTag(t: string) {
    const next = new Set(filterTags);
    if (next.has(t)) next.delete(t); else next.add(t);
    setFilterTags(next);
  }

  function toggleDiff(d: string) {
    const next = new Set(filterDiff);
    if (next.has(d)) next.delete(d); else next.add(d);
    setFilterDiff(next);
  }

  async function repeatLastRun() {
    if (!lastRun || prefilling) return;
    setPrefilling(true);
    setPrefillNote(null);
    try {
      const res = await fetch(`/api/runs/${lastRun.id}?lite=1`);
      if (!res.ok) throw new Error(`failed to load run (${res.status})`);
      const data = await res.json();
      const p = data.run?.params ?? {};
      if (p.runner === "headless" || p.runner === "tmux") setRunner(p.runner);
      setHarness(typeof p.harness === "string" && p.harness ? p.harness : undefined);
      setModel(typeof p.model === "string" && p.model ? p.model : undefined);
      if (Number.isFinite(p.parallel)) setParallelRaw(String(p.parallel));
      if (Number.isFinite(p.samples)) setSamplesRaw(String(p.samples));
      // Re-select exactly the cases that ran (params.filter can be any shape;
      // the run's case rows are the ground truth).
      const known = new Set(cases.map((c) => c.id));
      const ranIds: string[] = Array.isArray(data.cases)
        ? Array.from(new Set(data.cases.map((c: { case_id?: unknown }) => c.case_id).filter((id: unknown): id is string => typeof id === "string")))
        : [];
      const usable = ranIds.filter((id) => known.has(id));
      if (usable.length > 0) {
        setSelected(Object.fromEntries(usable.map((id) => [id, true])));
        setFilterCats(new Set(cases.map((c) => c.category)));
        setFilterDiff(new Set());
        setFilterTags(new Set());
        setSearch("");
      }
      const missing = ranIds.length - usable.length;
      const runName = typeof data.run?.name === "string" && data.run.name ? data.run.name : lastRun.name;
      setPrefillNote(
        `Prefilled from “${runName}”${usable.length > 0 ? ` — ${usable.length} case${usable.length === 1 ? "" : "s"} re-selected` : ""}${missing > 0 ? ` (${missing} no longer exist)` : ""}.`
      );
      setFieldErrors({});
    } catch (e: unknown) {
      setPrefillNote(null);
      setFieldErrors((prev) => ({ ...prev, general: `Repeat last run failed: ${String(e instanceof Error ? e.message : e)}` }));
    } finally {
      setPrefilling(false);
    }
  }

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setFieldErrors({});
    const useSelection = selectedCount > 0;
    // Always send resolved ids: server-side filter reconstruction dropped the
    // search query and disagreed with the UI on "untiered", so the preview lied.
    const caseIds = useSelection
      ? Object.entries(selected).filter(([, v]) => v).map(([k]) => k)
      : visible.map((c) => c.id);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || undefined,
          runner,
          harness,
          parallel: parallelParsed.value,
          samples: samplesParsed.value,
          model,
          caseIds,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({} as { error?: unknown; field?: unknown }));
        const message = typeof err.error === "string" && err.error ? err.error : `Failed to start run (${res.status})`;
        const field = isRunField(err.field) ? err.field : inferErrorField(message);
        setFieldErrors(field ? { [field]: message } : { general: message });
        setSubmitting(false);
        return;
      }
      const data = await res.json();
      router.push(`/runs/${data.id}`);
    } catch (e: unknown) {
      setFieldErrors({ general: String(e instanceof Error ? e.message : e) });
      setSubmitting(false);
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">New Run</h1>
          <p className="text-sm text-fg-muted mt-1">Configure and start a fresh evaluation run.</p>
        </div>
        <div className="text-right">
          <button
            type="button"
            onClick={repeatLastRun}
            disabled={!lastRun || prefilling}
            title={lastRun ? `Prefill this form from “${lastRun.name}”` : lastRun === undefined ? "Looking up previous runs…" : "No previous runs stored — start one first."}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-bd text-sm hover:bg-bg-elev disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {prefilling ? <Loader2 className="size-3.5 animate-spin" /> : <History className="size-3.5" />}
            Repeat last run
          </button>
          {lastRun === null && <div className="text-[10px] text-fg-dim mt-1">No previous runs yet.</div>}
          {lastRun && <div className="text-[10px] text-fg-dim mt-1 max-w-[200px] truncate">Last: {lastRun.name}</div>}
        </div>
      </header>
      {prefillNote && (
        <div className="mb-4 text-[11px] text-accent-soft border border-accent/30 bg-accent/5 rounded-md px-3 py-2" role="status">
          {prefillNote}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4">

          <section className="card p-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] uppercase tracking-wider text-fg-muted">Run name (optional)</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Auto-generated if blank"
                  className="mt-1.5 w-full px-3 py-2 text-sm bg-bg border border-bd rounded-md focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-fg-muted">Parallel workers</label>
                <input
                  type="number" min={1} max={8} value={parallelRaw}
                  aria-invalid={!!(parallelParsed.error || fieldErrors.parallel)}
                  onChange={(e) => { setParallelRaw(e.target.value); setFieldErrors((prev) => ({ ...prev, parallel: undefined })); }}
                  className={clsx(
                    "mt-1.5 w-full px-3 py-2 text-sm bg-bg border rounded-md mono focus:outline-none",
                    parallelParsed.error || fieldErrors.parallel ? "border-err focus:border-err" : "border-bd focus:border-accent"
                  )}
                />
                <div className="text-[10px] text-fg-dim mt-1">1–8 concurrent case workers</div>
                {(parallelParsed.error || fieldErrors.parallel) && (
                  <div role="alert" className="text-[11px] text-err mt-1">{fieldErrors.parallel || parallelParsed.error}</div>
                )}
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-fg-muted">Samples (pass@k)</label>
                <input
                  type="number" min={1} max={8} value={samplesRaw}
                  aria-invalid={!!(samplesParsed.error || fieldErrors.samples)}
                  onChange={(e) => { setSamplesRaw(e.target.value); setFieldErrors((prev) => ({ ...prev, samples: undefined })); }}
                  className={clsx(
                    "mt-1.5 w-full px-3 py-2 text-sm bg-bg border rounded-md mono focus:outline-none",
                    samplesParsed.error || fieldErrors.samples ? "border-err focus:border-err" : "border-bd focus:border-accent"
                  )}
                />
                <div className="text-[10px] text-fg-dim mt-1">Run each case k times (1–8) · report pass@1, pass@k, pass^k</div>
                {(samplesParsed.error || fieldErrors.samples) && (
                  <div role="alert" className="text-[11px] text-err mt-1">{fieldErrors.samples || samplesParsed.error}</div>
                )}
              </div>
            </div>

            <div className="mt-4">
              <label className="text-[11px] uppercase tracking-wider text-fg-muted">Runner</label>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {(["headless", "tmux"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRunner(r)}
                    className={clsx(
                      "px-3 py-2 rounded-md text-sm border text-left",
                      runner === r ? "border-accent bg-accent/10 text-accent-soft" : "border-bd hover:bg-bg-elev"
                    )}
                  >
                    <div className="font-medium">{r}</div>
                    <div className="text-[11px] text-fg-muted mt-0.5">{r === "headless" ? "Isolated subprocess per case" : "tmux session — watch live"}</div>
                  </button>
                ))}
              </div>
              {fieldErrors.runner && <div role="alert" className="text-[11px] text-err mt-1">{fieldErrors.runner}</div>}
            </div>

            <div className="mt-4">
              <label className="text-[11px] uppercase tracking-wider text-fg-muted">Harness</label>
              <div className="mt-1.5">
                <HarnessPicker
                  value={harness}
                  onChange={(h) => { setHarness(h); setFieldErrors((prev) => ({ ...prev, harness: undefined })); }}
                  onDiscovered={setHarnessInfo}
                />
              </div>
              <div className="text-[10px] text-fg-dim mt-1.5">Agent CLI to run cases against. Discovered from PATH — unavailable ones show their probe failure.</div>
              {harnessIssue && (
                <div role="alert" className={clsx("text-[11px] mt-1 flex items-start gap-1.5", harnessIssue.level === "error" ? "text-err" : "text-warn")}>
                  {harnessIssue.level === "error" ? <AlertCircle className="size-3 shrink-0 mt-0.5" /> : <AlertTriangle className="size-3 shrink-0 mt-0.5" />}
                  <span>{harnessIssue.message}</span>
                </div>
              )}
              {fieldErrors.harness && <div role="alert" className="text-[11px] text-err mt-1">{fieldErrors.harness}</div>}
            </div>

            <div className="mt-4">
              <label className="text-[11px] uppercase tracking-wider text-fg-muted">Model</label>
              <div className="mt-1.5">
                <ModelPicker value={model} onChange={(m) => { setModel(m); setFieldErrors((prev) => ({ ...prev, model: undefined })); }} harness={harness} />
              </div>
              <div className="text-[10px] text-fg-dim mt-1.5">Leave default to let the harness pick.</div>
              {fieldErrors.model && <div role="alert" className="text-[11px] text-err mt-1">{fieldErrors.model}</div>}
            </div>
          </section>

          <section className="card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-bd-subtle flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Filter className="size-3.5 text-fg-muted" />
                <span className="text-sm font-medium">Filter &amp; select cases</span>
              </div>
              <button onClick={toggleAll} className="text-[11px] text-accent-soft hover:underline">{allSelected ? "Clear" : "Select all visible"}</button>
            </div>
            {(fieldErrors.caseIds || plannedCaseCount === 0) && (
              <div role="alert" className="px-4 py-2 border-b border-bd-subtle text-[11px] text-err flex items-start gap-1.5">
                <AlertCircle className="size-3 shrink-0 mt-0.5" />
                <span>{fieldErrors.caseIds || "No cases to run — select cases below or widen the filters."}</span>
              </div>
            )}

            <div className="px-4 py-2.5 border-b border-bd-subtle flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  onClick={() => toggleCat(c)}
                  className={clsx(
                    "text-[11px] px-2.5 py-1.5 rounded-md border mono",
                    filterCats.has(c) ? "border-accent bg-accent/10 text-accent-soft" : "border-bd text-fg-muted hover:bg-bg-elev"
                  )}
                >
                  {c}
                </button>
              ))}
              <span className="mx-1 text-fg-dim text-xs">·</span>
              {["easy", "medium", "hard", "untiered"].map((d) => (
                <button
                  key={d}
                  onClick={() => toggleDiff(d)}
                  className={clsx(
                    "text-[11px] px-2.5 py-1.5 rounded-md border",
                    filterDiff.has(d) ? "border-accent bg-accent/10 text-accent-soft" : "border-bd text-fg-muted hover:bg-bg-elev"
                  )}
                >
                  {d}
                </button>
              ))}
              {allTags.length > 0 && <span className="mx-1 text-fg-dim text-xs">·</span>}
              {allTags.map((t) => (
                <button
                  key={t}
                  onClick={() => toggleTag(t)}
                  className={clsx(
                    "text-[11px] px-2.5 py-1.5 rounded-md border",
                    filterTags.has(t) ? "border-accent bg-accent/10 text-accent-soft" : "border-bd text-fg-muted hover:bg-bg-elev"
                  )}
                >
                  #{t}
                </button>
              ))}
            </div>

            <div className="px-4 py-2 border-b border-bd-subtle">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-fg-dim" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search cases…"
                  className="w-full pl-8 pr-2 py-1.5 text-xs bg-bg border border-bd rounded-md focus:outline-none focus:border-accent placeholder:text-fg-dim"
                />
              </div>
            </div>

            <div className="max-h-[400px] overflow-y-auto divide-y divide-bd-subtle">
              {visible.map((c) => {
                const sel = !!selected[c.id];
                return (
                  <button
                    key={c.id}
                    onClick={() => { setSelected({ ...selected, [c.id]: !sel }); setFieldErrors((prev) => ({ ...prev, caseIds: undefined })); }}
                    className={clsx("w-full text-left px-4 py-2.5 hover:bg-bg-elev transition-colors flex items-center gap-3", sel && "bg-accent/5")}
                  >
                    <div className={clsx("size-4 rounded border flex items-center justify-center shrink-0", sel ? "border-accent bg-accent" : "border-bd")}>
                      {sel && <Check className="size-3 text-white" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate">{c.name}</div>
                      <div className="text-[10px] text-fg-dim mono mt-0.5 flex items-center gap-1.5">
                        <span className="px-1 rounded bg-bg-elev">{c.category}</span>
                        · {c.graders.length} grader{c.graders.length === 1 ? "" : "s"}
                        {(c.tags ?? []).map((t) => <span key={t}>· #{t}</span>)}
                      </div>
                    </div>
                  </button>
                );
              })}
              {visible.length === 0 && <div className="px-4 py-8 text-center text-sm text-fg-muted">No cases match the filter.</div>}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="card p-5 sticky top-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-fg-muted">Run summary</div>
              <span className="text-[10px] text-fg-dim mono px-1.5 py-0.5 rounded bg-bg-elev tabular-nums">
                {totalRuns == null ? "—" : `${totalRuns} run${totalRuns !== 1 ? "s" : ""}`}
              </span>
            </div>
            <p className="text-[13px] leading-snug mb-3" data-testid="run-sentence">{sentence}</p>
            <dl className="space-y-1.5 text-sm border-l border-bd-subtle pl-3">
              <Row label="Cases" value={selectedCount > 0 ? `${selectedCount} selected` : `${visible.length} filtered`} />
              <Row label="Runner" value={runner} />
              <Row label="Harness" value={harness || "default"} />
              <Row label="Model" value={model || "default"} />
              <Row label="Parallel" value={parallelParsed.value != null ? `${parallelParsed.value}×` : "invalid"} />
              <Row label="Samples" value={samplesParsed.value == null ? "invalid" : samplesParsed.value > 1 ? `${samplesParsed.value} (pass@k)` : "1"} />
            </dl>
            <button
              onClick={submit}
              disabled={!canSubmit}
              title={blockers.length > 0 ? `Fix before starting: ${blockers.map((b) => b.message).join(" · ")}` : undefined}
              className="mt-4 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-md bg-accent hover:bg-accent/90 active:scale-[0.96] disabled:active:scale-100 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium"
            >
              <span className="icon-crossfade relative inline-flex size-4">
                <Play className={clsx("absolute inset-0 size-4", submitting ? "opacity-0" : "opacity-100")} />
                <Loader2 className={clsx("absolute inset-0 size-4 animate-spin", submitting ? "opacity-100" : "opacity-0")} />
              </span>
              {submitting ? "Starting…" : "Start run"}
            </button>
            {blockers.length > 0 && !submitting && (
              <ul className="mt-2 space-y-1" role="alert" data-testid="start-blockers">
                {blockers.map((b) => (
                  <li key={b.field} className="text-[11px] text-err flex items-start gap-1.5">
                    <AlertCircle className="size-3 shrink-0 mt-0.5" />
                    <span>{b.message}</span>
                  </li>
                ))}
              </ul>
            )}
            {fieldErrors.general && <div role="alert" className="mt-2 text-[11px] text-err">{fieldErrors.general}</div>}
            <div className="mt-3 pt-3 border-t border-bd-subtle text-[10px] text-fg-dim">
              Each case runs in an isolated workdir. Results stream to the run page in real time.
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="font-medium mono">{value}</dd>
    </div>
  );
}
