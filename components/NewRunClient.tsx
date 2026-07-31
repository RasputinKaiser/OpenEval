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
import { describeHarnessSelection } from "@/lib/adapters/diagnostics";
import { readRunDefaults } from "@/lib/run-defaults";
import { buildRunSentence, inferErrorField, isRunField, parseBoundedInt, type RunField } from "./newRunValidation";
import EvaluateNav from "./EvaluateNav";

interface Props { cases: CaseDefinition[]; initialCaseIds?: string[]; }

const CATEGORIES = ["agentic-swe", "single-tool", "reasoning", "visual-code"] as const;
const CATEGORY_LABELS: Record<string, string> = {
  "agentic-swe": "Agentic SWE",
  "single-tool": "Single tool",
  reasoning: "Reasoning",
  "visual-code": "Creative lab",
};
type BenchmarkPreset = {
  id: string;
  label: string;
  description: string;
  categories: readonly string[];
  caseIds?: readonly string[];
};

const PRESETS: BenchmarkPreset[] = [
  { id: "core", label: "Core suite", description: "SWE, tools, and reasoning", categories: ["agentic-swe", "single-tool", "reasoning"] },
  { id: "visual-sampler", label: "Creative sampler", description: "4 low-usage cases across scene, data, route, and runbook", categories: ["visual-code"], caseIds: ["visual-isometric-voxel-world", "visual-data-story-card", "visual-map-route-planner", "visual-markdown-runbook"] },
  { id: "visual", label: "Creative lab", description: "CSS scenes, dashboards, diagrams, data, and SVG", categories: ["visual-code"] },
  { id: "reasoning", label: "Reasoning", description: "Problems that reward careful thinking", categories: ["reasoning"] },
  { id: "all", label: "Everything", description: "Full catalog; highest usage", categories: [...CATEGORIES] },
];

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
  const [filterCats, setFilterCats] = useState<Set<string>>(() => new Set(
    initialCaseIds.length > 0 ? cases.map((c) => c.category) : ["agentic-swe", "single-tool", "reasoning"],
  ));
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
  // URL presets can contain ids that were removed from the catalog. Count and
  // submit only known cases so the preview cannot promise or launch phantom
  // executions from stale links.
  const knownCaseIds = new Set(cases.map((c) => c.id));
  const selectedCount = cases.filter((c) => selected[c.id]).length;
  const hasExplicitSelection = initialCaseIds.length > 0 || selectedCount > 0;
  const plannedCases = cases.filter((c) => hasExplicitSelection ? selected[c.id] : visible.some((v) => v.id === c.id));
  const plannedCaseIds = new Set(plannedCases.map((c) => c.id));
  const selectedHidden = plannedCases.filter((c) => !visible.some((v) => v.id === c.id));
  const plannedCaseCount = plannedCases.length;
  const selectedVisualCount = plannedCases.filter((c) => c.visual).length;

  // ── Inline validation (mirrors app/api/runs POST rules; the API 400 is a backstop) ──
  const parallelParsed = parseBoundedInt(parallelRaw);
  const samplesParsed = parseBoundedInt(samplesRaw);
  const declaredBudgetCases = plannedCases.filter((c) => typeof c.budget?.max_cost_usd === "number" && Number.isFinite(c.budget.max_cost_usd) && c.budget.max_cost_usd >= 0).length;
  const plannedBudgetCeiling = plannedCases
    .reduce((sum, c) => sum + (typeof c.budget?.max_cost_usd === "number" && Number.isFinite(c.budget.max_cost_usd) && c.budget.max_cost_usd >= 0 ? c.budget.max_cost_usd : 0), 0) * (samplesParsed.value ?? 1);
  const budgetLabel = declaredBudgetCases === 0
    ? "not declared"
    : `~$${plannedBudgetCeiling.toFixed(2)} declared for ${declaredBudgetCases}/${plannedCases.length} case${plannedCases.length === 1 ? "" : "s"}`;
  const harnessSelection = describeHarnessSelection({
    value: harness,
    defaultHarness: harnessInfo?.defaultHarness,
    harnesses: harnessInfo?.harnesses ?? [],
  });
  const selectedHarness = harnessSelection.selected;
  const effectiveHarness = harness || harnessInfo?.defaultHarness;
  const harnessIssue: { level: "error" | "warn"; message: string } | null = !harnessInfo
    ? { level: "warn", message: "Checking harness availability before launch…" }
    : harnessSelection.diagnostic
      ? { level: harnessSelection.diagnostic.level, message: `${harnessSelection.diagnostic.title}: ${harnessSelection.diagnostic.message}` }
      : null;

  const blockers: { field: string; message: string }[] = [];
  if (parallelParsed.error) blockers.push({ field: "parallel", message: `Parallel workers: ${parallelParsed.error}` });
  if (samplesParsed.error) blockers.push({ field: "samples", message: `Samples: ${samplesParsed.error}` });
  if (plannedCaseCount === 0) blockers.push({ field: "caseIds", message: "No cases to run — select cases or widen the filters." });
  if (harnessIssue && (!harnessInfo || harnessIssue.level === "error")) blockers.push({ field: "harness", message: `Harness: ${harnessIssue.message}` });
  const canSubmit = !submitting && blockers.length === 0;

  const plannedExecutions = samplesParsed.value != null ? plannedCaseCount * samplesParsed.value : null;
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

  function applyPreset(preset: Pick<BenchmarkPreset, "categories" | "caseIds">) {
    const nextCategories = new Set(preset.categories);
    const targetIds = preset.caseIds ? new Set(preset.caseIds) : null;
    setFilterCats(nextCategories);
    setFilterDiff(new Set());
    setFilterTags(new Set());
    setSearch("");
    setSelected(Object.fromEntries(cases.filter((c) => nextCategories.has(c.category) && (!targetIds || targetIds.has(c.id))).map((c) => [c.id, true])));
    setFieldErrors((prev) => ({ ...prev, caseIds: undefined }));
  }

  function clearAllSelected() {
    setSelected({});
    setFieldErrors((prev) => ({ ...prev, caseIds: undefined }));
  }

  function showSelectedCases() {
    setFilterCats(new Set(CATEGORIES));
    setFilterDiff(new Set());
    setFilterTags(new Set());
    setSearch("");
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
    const useSelection = hasExplicitSelection;
    // Always send resolved ids: server-side filter reconstruction dropped the
    // search query and disagreed with the UI on "untiered", so the preview lied.
    const caseIds = useSelection
      ? Object.entries(selected).filter(([id, v]) => v && knownCaseIds.has(id)).map(([k]) => k)
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
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
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
      <EvaluateNav />
      {prefillNote && (
        <div className="mb-4 text-[11px] text-accent-soft border border-accent/30 bg-accent/5 rounded-md px-3 py-2" role="status">
          {prefillNote}
        </div>
      )}

      <section className="card mb-4 p-4 sm:p-5" aria-labelledby="recipe-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="recipe-title" className="text-sm font-medium">Build a benchmark recipe</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-fg-muted">Start with a focused lane, then tune the execution. Presets keep the first run useful and affordable; every case remains selectable below.</p>
          </div>
          <div className="text-right text-[11px] text-fg-dim">
            <div><span className="font-medium text-fg">{plannedCaseCount}</span> planned case{plannedCaseCount === 1 ? "" : "s"}</div>
            <div><span className="font-medium text-fg">{selectedVisualCount}</span> visual lane{selectedVisualCount === 1 ? "" : "s"}</div>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {PRESETS.map((preset) => {
            const targetIds = preset.caseIds ? new Set(preset.caseIds) : null;
            const presetCaseIds = targetIds ?? new Set(cases.filter((c) => preset.categories.includes(c.category)).map((c) => c.id));
            const active = preset.categories.length === filterCats.size && preset.categories.every((category) => filterCats.has(category)) && filterDiff.size === 0 && filterTags.size === 0 && !search && plannedCaseIds.size === presetCaseIds.size && [...presetCaseIds].every((id) => plannedCaseIds.has(id));
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset)}
                aria-pressed={active}
                data-testid={`run-preset-${preset.id}`}
                className={clsx("rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent", active ? "border-accent bg-accent/10" : "border-bd-subtle hover:bg-bg-elev")}
              >
                <div className={clsx("text-sm font-medium", active ? "text-accent-soft" : "text-fg")}>{preset.label}</div>
                <div className="mt-1 text-[11px] leading-4 text-fg-muted">{preset.description}</div>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-bd-subtle pt-3 text-[11px] text-fg-dim">
          <span>Planned executions: <strong className="text-fg">{plannedExecutions ?? "—"}</strong></span>
          <span>Case budget ceiling: <strong className="text-fg">{budgetLabel}</strong></span>
          <span>Ceiling is per-case configuration, not provider billing.</span>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4">

          <section className="card p-5" aria-labelledby="execution-settings-title">
            <div className="mb-4">
              <h2 id="execution-settings-title" className="text-sm font-medium">Execution settings</h2>
              <p className="mt-1 text-xs leading-5 text-fg-muted">Name the run, set a bounded sample plan, then choose the agent setup.</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="run-name" className="text-[11px] uppercase tracking-wider text-fg-muted">Run name (optional)</label>
                <input
                  id="run-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Auto-generated if blank"
                  className="mt-1.5 min-h-11 w-full rounded-md border border-bd bg-bg px-3 text-sm outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>
              <div>
                <label htmlFor="parallel-workers" className="text-[11px] uppercase tracking-wider text-fg-muted">Parallel workers</label>
                <input
                  id="parallel-workers"
                  type="number" inputMode="numeric" min={1} max={8} value={parallelRaw}
                  aria-invalid={!!(parallelParsed.error || fieldErrors.parallel)}
                  onChange={(e) => { setParallelRaw(e.target.value); setFieldErrors((prev) => ({ ...prev, parallel: undefined })); }}
                  className={clsx(
                    "mt-1.5 min-h-11 w-full rounded-md border bg-bg px-3 text-sm mono outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    parallelParsed.error || fieldErrors.parallel ? "border-err focus:border-err" : "border-bd focus:border-accent"
                  )}
                />
                <div className="text-[10px] text-fg-dim mt-1">1–8 concurrent case workers</div>
                {(parallelParsed.error || fieldErrors.parallel) && (
                  <div role="alert" className="text-[11px] text-err mt-1">{fieldErrors.parallel || parallelParsed.error}</div>
                )}
              </div>
              <div>
                <label htmlFor="run-samples" className="text-[11px] uppercase tracking-wider text-fg-muted">Samples (pass@k)</label>
                <input
                  id="run-samples"
                  type="number" inputMode="numeric" min={1} max={8} value={samplesRaw}
                  aria-invalid={!!(samplesParsed.error || fieldErrors.samples)}
                  onChange={(e) => { setSamplesRaw(e.target.value); setFieldErrors((prev) => ({ ...prev, samples: undefined })); }}
                  className={clsx(
                    "mt-1.5 min-h-11 w-full rounded-md border bg-bg px-3 text-sm mono outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    samplesParsed.error || fieldErrors.samples ? "border-err focus:border-err" : "border-bd focus:border-accent"
                  )}
                />
                <div className="text-[10px] text-fg-dim mt-1">Run each case k times (1–8) · report pass@1, pass@k, pass^k</div>
                {(samplesParsed.error || fieldErrors.samples) && (
                  <div role="alert" className="text-[11px] text-err mt-1">{fieldErrors.samples || samplesParsed.error}</div>
                )}
              </div>
            </div>

            <div className="mt-5 border-t border-bd-subtle pt-4">
              <h3 className="text-xs font-medium uppercase tracking-wider text-fg-muted">Agent setup</h3>
            </div>
            <div className="mt-3">
              <label className="text-[11px] uppercase tracking-wider text-fg-muted">Runner</label>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {(["headless", "tmux"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRunner(r)}
                    aria-pressed={runner === r}
                    className={clsx(
                      "min-h-11 rounded-md border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
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
              <label htmlFor="run-harness" className="text-[11px] uppercase tracking-wider text-fg-muted">Harness</label>
              <div className="mt-1.5">
                <HarnessPicker
                  id="run-harness"
                  label="Harness"
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
              <label htmlFor="run-model" className="text-[11px] uppercase tracking-wider text-fg-muted">Model</label>
              <div className="mt-1.5">
                <ModelPicker id="run-model" label="Model" value={model} onChange={(m) => { setModel(m); setFieldErrors((prev) => ({ ...prev, model: undefined })); }} harness={effectiveHarness} />
              </div>
              <div className="text-[10px] text-fg-dim mt-1.5">Leave default to let the harness pick.</div>
              {fieldErrors.model && <div role="alert" className="text-[11px] text-err mt-1">{fieldErrors.model}</div>}
            </div>
          </section>

          <section className="card overflow-hidden" aria-labelledby="case-selection-title">
            <div className="px-4 py-3 border-b border-bd-subtle flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <Filter className="size-3.5 text-fg-muted" />
                <div>
                  <h2 id="case-selection-title" className="text-sm font-medium">Choose benchmark cases</h2>
                  <p className="mt-1 text-xs text-fg-muted">Use a preset above or refine the catalog by category, difficulty, tags, and search.</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {selectedCount > 0 && <button type="button" onClick={clearAllSelected} className="min-h-10 rounded-md px-2 text-[11px] text-fg-muted hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Clear all</button>}
                <button type="button" onClick={toggleAll} className="min-h-10 rounded-md px-2 text-[11px] text-accent-soft hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{allSelected ? "Clear visible" : "Select all visible"}</button>
              </div>
            </div>
            {(fieldErrors.caseIds || plannedCaseCount === 0) && (
              <div role="alert" className="px-4 py-2 border-b border-bd-subtle text-[11px] text-err flex items-start gap-1.5">
                <AlertCircle className="size-3 shrink-0 mt-0.5" />
                <span>{fieldErrors.caseIds || "No cases to run — select cases below or widen the filters."}</span>
              </div>
            )}

            <div className="space-y-3 border-b border-bd-subtle px-4 py-3">
              <fieldset>
                <legend className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-fg-dim">Category</legend>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => toggleCat(c)}
                      aria-pressed={filterCats.has(c)}
                      className={clsx(
                        "min-h-10 rounded-md border px-2.5 py-1.5 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        filterCats.has(c) ? "border-accent bg-accent/10 text-accent-soft" : "border-bd text-fg-muted hover:bg-bg-elev"
                      )}
                    >
                      {CATEGORY_LABELS[c]}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-fg-dim">Difficulty</legend>
                <div className="flex flex-wrap gap-2">
                  {["easy", "medium", "hard", "untiered"].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDiff(d)}
                      aria-pressed={filterDiff.has(d)}
                      className={clsx(
                        "min-h-10 rounded-md border px-2.5 py-1.5 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        filterDiff.has(d) ? "border-accent bg-accent/10 text-accent-soft" : "border-bd text-fg-muted hover:bg-bg-elev"
                      )}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </fieldset>
              {allTags.length > 0 && <fieldset><legend className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-fg-dim">Tags</legend><div className="flex flex-wrap gap-2">
                {allTags.map((t) => (
                  <button key={t} type="button" onClick={() => toggleTag(t)} aria-pressed={filterTags.has(t)} className={clsx("min-h-10 rounded-md border px-2.5 py-1.5 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent", filterTags.has(t) ? "border-accent bg-accent/10 text-accent-soft" : "border-bd text-fg-muted hover:bg-bg-elev")}>#{t}</button>
                ))}
              </div></fieldset>}
            </div>

            <div className="px-4 py-2 border-b border-bd-subtle">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-fg-dim" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search cases…"
                  aria-label="Search cases"
                  className="min-h-10 w-full rounded-md border border-bd bg-bg py-1.5 pl-8 pr-2 text-xs outline-none placeholder:text-fg-dim focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>
            </div>

            {selectedHidden.length > 0 && (
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-accent/30 bg-accent/10 px-4 py-3" role="status" data-testid="hidden-selected-cases">
                <div className="min-w-0 text-[11px] leading-4">
                  <div className="font-medium text-accent-soft">{selectedHidden.length} selected case{selectedHidden.length === 1 ? "" : "s"} hidden by the current filters</div>
                  <div className="mt-0.5 truncate text-fg-muted">{selectedHidden.slice(0, 3).map((c) => c.name).join(" · ")}{selectedHidden.length > 3 ? " · +" + (selectedHidden.length - 3) + " more" : ""}</div>
                </div>
                <button type="button" onClick={showSelectedCases} className="min-h-10 shrink-0 rounded-md border border-accent/50 px-2.5 py-1.5 text-[11px] text-accent-soft hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Show selected</button>
              </div>
            )}

            <div className="max-h-[400px] overflow-y-auto divide-y divide-bd-subtle">
              {visible.map((c) => {
                const sel = !!selected[c.id];
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { setSelected({ ...selected, [c.id]: !sel }); setFieldErrors((prev) => ({ ...prev, caseIds: undefined })); }}
                    aria-pressed={sel}
                    className={clsx("w-full min-h-14 text-left px-4 py-2.5 hover:bg-bg-elev transition-colors flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent", sel && "bg-accent/5")}
                  >
                    <div className={clsx("size-4 rounded border flex items-center justify-center shrink-0", sel ? "border-accent bg-accent" : "border-bd")}>
                      {sel && <Check className="size-3 text-white" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate">{c.name}</div>
                      <div className="text-[10px] text-fg-dim mono mt-0.5 flex items-center gap-1.5">
                        <span className="px-1 rounded bg-bg-elev">{CATEGORY_LABELS[c.category] ?? c.category}</span>
                        · {c.difficulty ?? "untiered"}
                        · {c.graders.length} grader{c.graders.length === 1 ? "" : "s"}
                        {(c.tags ?? []).map((t) => <span key={t}>· #{t}</span>)}
                      </div>
                      {(c.visual || c.benchmark?.deliverable) && <div className="mt-1 text-[10px] text-fg-dim line-clamp-2">{c.visual && <>Output: {visualKindLabel(c.visual.kind)}</>}{c.visual && c.benchmark?.deliverable && <span> · </span>}{c.benchmark?.deliverable && <>Deliverable: {c.benchmark.deliverable}</>}</div>}
                      {c.benchmark?.intent && <div className="mt-1 text-[10px] leading-4 text-fg-muted line-clamp-2">Measures: {c.benchmark.intent}</div>}
                      {(c.benchmark?.evidence?.length || c.budget?.max_cost_usd != null || c.budget?.max_turns != null) && <div className="mt-1 text-[10px] leading-4 text-fg-dim line-clamp-2">{c.benchmark?.evidence?.length ? <>Evidence: {c.benchmark.evidence.join(" · ")}</> : null}{c.budget?.max_cost_usd != null && <span> · max ~${c.budget.max_cost_usd.toFixed(2)}</span>}{c.budget?.max_turns != null && <span> · {c.budget.max_turns} max turns</span>}</div>}
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
                {plannedExecutions == null ? "—" : `${plannedExecutions} case execution${plannedExecutions !== 1 ? "s" : ""}`}
              </span>
            </div>
            <p className="text-[13px] leading-snug mb-3" data-testid="run-sentence">{sentence}</p>
            <dl className="space-y-1.5 text-sm border-l border-bd-subtle pl-3">
              <Row label="Cases" value={hasExplicitSelection ? String(selectedCount) + " selected" + (selectedHidden.length > 0 ? " · " + selectedHidden.length + " hidden" : "") : String(visible.length) + " filtered"} />
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
              className="mt-4 min-h-11 w-full flex items-center justify-center gap-2 rounded-md bg-accent px-3 py-2.5 text-sm font-medium text-white hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.96] disabled:active:scale-100 disabled:opacity-50 disabled:cursor-not-allowed"
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

function visualKindLabel(kind: string): string {
  return ({
    svg: "SVG",
    threejs: "3D scene",
    web_ui: "HTML/CSS UI",
    app_ui: "App UI",
    screenshot: "Screenshot",
    canvas: "Canvas",
    data: "Data story",
    diagram: "Diagram",
    text: "Text / Markdown",
  } as Record<string, string>)[kind] ?? kind;
}
