"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Database,
  HardDrive,
  KeyRound,
  Loader2,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Save,
  Settings as SettingsIcon,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Stethoscope,
  Trash2,
  Wrench,
} from "lucide-react";
import PageHeader from "./PageHeader";
import HarnessPicker from "./HarnessPicker";
import ModelPicker from "./ModelPicker";
import SystemNav from "./SystemNav";
import { useRedaction } from "@/lib/use-redaction";
import {
  boundedRunInt,
  DEFAULT_RUN_SETTINGS as DEFAULTS,
  readRunDefaults,
  RUN_DEFAULTS_KEY,
  type RunSettings as Settings,
} from "@/lib/run-defaults";
import { ONBOARDING_DISMISSED_KEY, SHOW_ONBOARDING_EVENT } from "./first-run-steps";

type JudgeSettings = { judgeSource: string; judgeModel: string };
type EffectiveJudge = { source: string; model: string; name: string };
type EnvironmentOverrides = { source: boolean; model: boolean; openrouterKey: boolean };
type EnvironmentOverrideValues = { judgeHarness: string | null; judgeModel: string | null };
type HarnessOption = { id: string; label: string; status: string };
type DbStats = {
  path: string;
  sizeBytes: number;
  walBytes: number;
  shmBytes: number;
  pageSizeBytes: number;
  pageCount: number;
  freelistPages: number;
  journalMode: string;
  schemaVersion: number;
  tables: { runs: number; run_cases: number; events: number };
  recovery: { movedAsideTo?: string; reason?: string } | null;
};
type StorageInventoryEntry = {
  id: string;
  label: string;
  path: string;
  bytes: number;
  files: number;
  directories: number;
  status: "measured" | "missing" | "partial";
  retention: string;
};
type StorageInventory = {
  generatedAt: number;
  totalBytes: number;
  complete: boolean;
  entries: StorageInventoryEntry[];
  warnings: string[];
};
type MaintenancePayload = { db: DbStats; inventory?: StorageInventory };
type MaintenanceAction = "quick_check" | "integrity_check" | "checkpoint" | "vacuum";

export default function SettingsClient() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [savedSettings, setSavedSettings] = useState<Settings | null>(null);
  const [judge, setJudge] = useState<JudgeSettings>({ judgeSource: "", judgeModel: "" });
  const [savedJudge, setSavedJudge] = useState<JudgeSettings | null>(null);
  const [effectiveJudge, setEffectiveJudge] = useState<EffectiveJudge | null>(null);
  const [environmentOverrides, setEnvironmentOverrides] = useState<EnvironmentOverrides>({ source: false, model: false, openrouterKey: false });
  const [environmentOverrideValues, setEnvironmentOverrideValues] = useState<EnvironmentOverrideValues>({ judgeHarness: null, judgeModel: null });
  const [maintenance, setMaintenance] = useState<MaintenancePayload | null>(null);
  const [harnessOptions, setHarnessOptions] = useState<HarnessOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingsReady, setSettingsReady] = useState(false);
  const settingsReadyRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);
  const [maintenanceBusy, setMaintenanceBusy] = useState<MaintenanceAction | null>(null);
  const [maintenanceNotice, setMaintenanceNotice] = useState<string | null>(null);
  const [confirmVacuum, setConfirmVacuum] = useState(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maintenanceRequestRef = useRef(0);
  const { redact, setRedact } = useRedaction();

  const loadMaintenance = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++maintenanceRequestRef.current;
    try {
      const response = await fetch("/api/settings/maintenance", { cache: "no-store", signal });
      if (!response.ok) return;
      const body = await response.json() as MaintenancePayload;
      if (requestId === maintenanceRequestRef.current && !signal?.aborted && body?.db && typeof body.db === "object") {
        setMaintenance(body);
      }
    } catch {
      // Optional local-only surface; core Settings remains usable without it.
    }
  }, []);

  useEffect(() => {
    const wasSettingsReady = settingsReadyRef.current;
    settingsReadyRef.current = false;
    setLoading(true);
    setSettingsReady(false);
    setError(null);
    setLoadError(null);
    const local = readRunDefaults();
    const shouldHydrateLocalState = loadAttempt === 0;
    if (shouldHydrateLocalState) {
      setSettings(local);
      setSavedSettings(local);
    }
    const controller = new AbortController();

    const loadJudge = fetch("/api/settings", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Settings unavailable (${response.status})`);
        return response.json() as Promise<{
          settings: JudgeSettings;
          effectiveJudge: EffectiveJudge;
          environmentOverrides: EnvironmentOverrides;
          environmentOverrideValues?: EnvironmentOverrideValues;
        }>;
      })
      .then((body) => {
        // A retry after a partial load must not discard edits made in the
        // meantime. Only hydrate judge state when it was not loaded yet or on
        // the initial mount; the request still refreshes the effective view.
        const shouldHydrateJudge = loadAttempt === 0 || !wasSettingsReady;
        const next = {
          judgeSource: body.settings?.judgeSource ?? "",
          judgeModel: body.settings?.judgeModel ?? "",
        };
        if (shouldHydrateJudge) {
          setJudge(next);
          setSavedJudge(next);
        }
        setEffectiveJudge(body.effectiveJudge ?? null);
        setEnvironmentOverrides(body.environmentOverrides ?? { source: false, model: false, openrouterKey: false });
        setEnvironmentOverrideValues(body.environmentOverrideValues ?? { judgeHarness: null, judgeModel: null });
        settingsReadyRef.current = true;
        setSettingsReady(true);
      });

    const loadHarnesses = fetch("/api/harnesses", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Harness registry unavailable (${response.status})`);
        return response.json() as Promise<{ harnesses?: HarnessOption[] }>;
      })
      .then((body) => setHarnessOptions((body.harnesses ?? []).map((h) => ({ id: h.id, label: h.label, status: h.status }))));

    Promise.allSettled([loadJudge, loadHarnesses]).then((results) => {
      if (controller.signal.aborted) return;
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
      if (failures.length) {
        const message = failures.join(" · ");
        setLoadError(message);
        setError(message);
      }
      else setLoadError(null);
      setLoading(false);
    });
    void loadMaintenance(controller.signal);

    return () => {
      maintenanceRequestRef.current += 1;
      controller.abort();
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, [loadAttempt, loadMaintenance]);

  const runDirty = savedSettings != null && !same(settings, savedSettings);
  const judgeDirty = savedJudge != null && !same(judge, savedJudge);
  const dirtyScopes = [runDirty ? "run defaults" : null, judgeDirty ? "judge backend" : null].filter(Boolean) as string[];
  const dirty = dirtyScopes.length > 0;

  function notify(message: string) {
    setSavedNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setSavedNotice(null), 2600);
  }

  function replayTour() {
    try { localStorage.removeItem(ONBOARDING_DISMISSED_KEY); } catch {}
    window.dispatchEvent(new Event(SHOW_ONBOARDING_EVENT));
  }

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function updateJudge<K extends keyof JudgeSettings>(key: K, value: JudgeSettings[K]) {
    setJudge((current) => ({ ...current, [key]: value }));
  }

  function retryLoading() {
    setError(null);
    setLoading(true);
    setSettingsReady(false);
    setLoadAttempt((attempt) => attempt + 1);
  }

  async function save() {
    if (!dirty || !settingsReady) return;
    const judgeSnapshot = judge;
    const settingsSnapshot = settings;
    setSaving(true);
    setError(null);
    setSavedNotice(null);
    let serverSaved = false;
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(judgeSnapshot),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Could not save judge settings (${response.status})`);
      serverSaved = true;
      const confirmedJudge: JudgeSettings = {
        judgeSource: typeof body.settings?.judgeSource === "string" ? body.settings.judgeSource : judgeSnapshot.judgeSource,
        judgeModel: typeof body.settings?.judgeModel === "string" ? body.settings.judgeModel : judgeSnapshot.judgeModel,
      };
      // Keep edits made while the request was in flight. The server response
      // confirms only the snapshot that was actually sent.
      setJudge((current) => same(current, judgeSnapshot) ? confirmedJudge : current);
      setSavedJudge(confirmedJudge);
      setEffectiveJudge(body.effectiveJudge ?? null);

      try {
        localStorage.setItem(RUN_DEFAULTS_KEY, JSON.stringify(settingsSnapshot));
      } catch {
        throw new Error("Judge settings were saved, but this browser rejected the run-default write.");
      }
      setSavedSettings(settingsSnapshot);
      notify(`Saved ${dirtyScopes.join(" and ")}.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(serverSaved ? message : `Nothing was saved. ${message}`);
    } finally {
      setSaving(false);
    }
  }

  async function resetDefaultsAndJudge() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ judgeSource: "", judgeModel: "" }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Could not reset settings (${response.status})`);
      const resetRun = { ...DEFAULTS };
      try {
        localStorage.removeItem(RUN_DEFAULTS_KEY);
      } catch {
        throw new Error("Judge settings were reset, but this browser rejected the run-default reset.");
      }
      setSettings(resetRun);
      setSavedSettings(resetRun);
      setJudge({ judgeSource: "", judgeModel: "" });
      setSavedJudge({ judgeSource: "", judgeModel: "" });
      setEffectiveJudge(body.effectiveJudge ?? null);
      setConfirmReset(false);
      notify("Run defaults and judge backend reset.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  async function runMaintenance(action: MaintenanceAction) {
    if (maintenanceBusy) return;
    setMaintenanceBusy(action);
    setMaintenanceNotice(null);
    setError(null);
    try {
      const response = await fetch("/api/settings/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Maintenance action failed (${response.status})`);
      if (body.db) setMaintenance((current) => ({ db: body.db, inventory: body.inventory ?? current?.inventory }));
      if (action === "quick_check" || action === "integrity_check") {
        setMaintenanceNotice(body.ok ? `${action === "quick_check" ? "Quick" : "Full"} integrity check passed.` : `Integrity check reported ${(body.messages ?? []).length} issue(s).`);
      } else if (action === "checkpoint") {
        setMaintenanceNotice(`WAL checkpoint completed; ${body.result?.checkpointed ?? 0} frame(s) checkpointed.`);
      } else {
        setMaintenanceNotice(`Vacuum completed: ${formatBytes(body.sizeBefore)} → ${formatBytes(body.sizeAfter)}.`);
        setConfirmVacuum(false);
      }
      await loadMaintenance();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMaintenanceBusy(null);
    }
  }

  const sourceOptions = harnessOptions.filter((h) => h.id !== "openrouter");
  const selectedSource = sourceOptions.find((h) => h.id === judge.judgeSource);
  const staleSource = judge.judgeSource && judge.judgeSource !== "openrouter" && !selectedSource;
  const selectedUnavailable = selectedSource && selectedSource.status !== "available";
  const openRouterUnavailable = judge.judgeSource === "openrouter" && !environmentOverrides.openrouterKey;
  const db = maintenance?.db;
  const inventory = maintenance?.inventory;
  const totalRecords = db ? db.tables.runs + db.tables.run_cases + db.tables.events : 0;
  const reclaimableBytes = db ? db.freelistPages * db.pageSizeBytes : 0;
  const storageMax = db ? Math.max(1, db.sizeBytes + db.walBytes + db.shmBytes) : 1;
  const effectiveSource = environmentOverrides.source ? "environment" : savedJudge?.judgeSource ? "saved setting" : "automatic fallback";

  return (
    <div className="mx-auto min-w-0 max-w-6xl px-4 py-5 sm:p-6 lg:p-8">
      <PageHeader
        icon={SettingsIcon}
        title="Settings"
        subtitle="Control browser defaults, global judge fallback, privacy, and local storage health."
        actions={
          dirty ? <span className="rounded-lg border border-warn/25 bg-warn/10 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-warn">{dirtyScopes.length} unsaved scope{dirtyScopes.length === 1 ? "" : "s"}</span>
            : <span className="rounded-lg border border-ok/20 bg-ok/10 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-ok">Up to date</span>
        }
      />
      <SystemNav />

      <div aria-live="polite" className="sr-only">{savedNotice || maintenanceNotice}</div>
      {error && (
        <div role="alert" className="mb-4 flex items-start gap-3 rounded-xl border border-err/30 bg-err/5 p-3 text-sm text-err">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p>{error}</p>
            {loadError && (
              <button type="button" onClick={retryLoading} className="mt-2 rounded-md border border-err/30 px-2.5 py-1.5 text-xs font-medium text-err hover:bg-err/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                Retry loading settings
              </button>
            )}
          </div>
        </div>
      )}

      <section aria-label="Configuration summary" className="mb-5 grid grid-cols-2 overflow-hidden rounded-xl border border-bd bg-bg-subtle lg:grid-cols-4">
        <Summary icon={SlidersHorizontal} label="Run defaults" value={runDirty ? "Unsaved" : "Browser local"} detail={`${settings.defaultParallel} parallel · ${settings.defaultSamples} sample${settings.defaultSamples === 1 ? "" : "s"}`} tone={runDirty ? "warn" : undefined} />
        <Summary icon={KeyRound} label="Global judge" value={effectiveJudge?.name ?? (loading ? "Loading…" : "Unavailable")} detail={`resolved from ${effectiveSource}`} />
        <Summary icon={ShieldCheck} label="Path redaction" value={redact ? "On" : "Off"} detail="applies immediately" tone={redact ? "ok" : "warn"} />
        <Summary icon={HardDrive} label="Local database" value={db ? formatBytes(db.sizeBytes) : "Checking…"} detail={db ? `${totalRecords.toLocaleString()} records · ${db.journalMode.toUpperCase()}` : "local diagnostics"} />
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <main className="min-w-0 space-y-5">
          <section aria-labelledby="run-defaults-title" className="card p-4 sm:p-5">
            <SectionTitle icon={SlidersHorizontal} id="run-defaults-title" title="Run defaults" scope="This browser" detail="Pre-fills New Run. URL parameters and re-run links still take precedence." dirty={runDirty} />
            <div className="mt-5 grid gap-4">
              <Field id="default-harness" label="Default harness" hint="Leave automatic to use the registry default.">
                <HarnessPicker id="default-harness" value={settings.defaultHarness || undefined} onChange={(value) => update("defaultHarness", value ?? "")} label="Default harness" />
              </Field>
              <Field id="default-model" label="Default model" hint="Model availability is scoped to the selected harness when possible.">
                <ModelPicker id="default-model" value={settings.defaultModel || undefined} onChange={(value) => update("defaultModel", value ?? "")} harness={settings.defaultHarness || undefined} label="Default model" />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field id="default-parallel" label="Parallel workers" hint="1–8 concurrent cases.">
                  <input id="default-parallel" type="number" inputMode="numeric" step={1} min={1} max={8} value={settings.defaultParallel} onChange={(event) => update("defaultParallel", boundedRunInt(event.target.value))} className="min-h-11 w-full rounded-lg border border-bd bg-bg px-3 text-sm mono outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent" />
                </Field>
                <Field id="default-samples" label="Samples per case" hint="1–8 repeated attempts.">
                  <input id="default-samples" type="number" inputMode="numeric" step={1} min={1} max={8} value={settings.defaultSamples} onChange={(event) => update("defaultSamples", boundedRunInt(event.target.value))} className="min-h-11 w-full rounded-lg border border-bd bg-bg px-3 text-sm mono outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent" />
                </Field>
              </div>
            </div>
          </section>

          <section aria-labelledby="judge-title" className="card p-4 sm:p-5">
            <SectionTitle icon={Sparkles} id="judge-title" title="Global judge fallback" scope="This machine" detail="Used when a rubric or run does not specify its own judge backend or model." dirty={judgeDirty} />
            <div className="mt-5 space-y-4">
              <Field id="judge-source" label="Saved judge source" hint="Unavailable sources remain visible for recovery but cannot successfully judge until installed/configured.">
                <select id="judge-source" value={judge.judgeSource} disabled={!settingsReady} onChange={(event) => updateJudge("judgeSource", event.target.value)} className="min-h-11 w-full rounded-lg border border-bd bg-bg px-3 text-sm mono outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
                  <option value="">Automatic (environment, then OpenRouter/Codex)</option>
                  <option value="openrouter">OpenRouter HTTP backend · {environmentOverrides.openrouterKey ? "key detected" : "no key detected"}</option>
                  {sourceOptions.map((h) => <option key={h.id} value={h.id}>{h.label} ({h.id}){h.status !== "available" ? ` · ${h.status}` : ""}</option>)}
                  {staleSource ? <option value={judge.judgeSource}>{judge.judgeSource} · saved custom source</option> : null}
                </select>
              </Field>
              <Field id="judge-model" label="Saved judge model" hint="Leave automatic to use the selected backend’s safe default. Custom provider ids are supported.">
                <ModelPicker id="judge-model" value={judge.judgeModel || undefined} onChange={(value) => updateJudge("judgeModel", value ?? "")} harness={judge.judgeSource && judge.judgeSource !== "openrouter" ? judge.judgeSource : undefined} label="Saved judge model" />
              </Field>

              {(selectedUnavailable || openRouterUnavailable) && (
                <div className="flex items-start gap-2 rounded-lg border border-warn/25 bg-warn/5 p-3 text-xs text-warn">
                  <AlertCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                  {selectedUnavailable
                    ? `${selectedSource?.label} is registered but its current probe status is ${selectedSource?.status}. Judging will fail until the CLI is available.`
                    : "OpenRouter is selected but no OPENROUTER_API_KEY is detected. Judging will fail until the key is configured."}
                </div>
              )}
            </div>

            <div className="mt-5 rounded-xl border border-bd-subtle bg-bg/40 p-4">
              <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-fg-dim">Resolution order</div>
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
                <ResolutionStep label="Saved" value={savedJudge ? `${savedJudge.judgeSource || "auto"}${savedJudge.judgeModel ? ` / ${savedJudge.judgeModel}` : ""}` : "loading"} active={!environmentOverrides.source && !environmentOverrides.model} />
                <span aria-hidden="true" className="hidden text-center text-fg-dim sm:block">→</span>
                <ResolutionStep label="Environment" value={environmentOverrides.source || environmentOverrides.model ? `${environmentOverrideValues.judgeHarness ?? "source unchanged"} / ${environmentOverrideValues.judgeModel ?? "model unchanged"}` : "no override"} active={environmentOverrides.source || environmentOverrides.model} tone="warn" />
                <span aria-hidden="true" className="hidden text-center text-fg-dim sm:block">→</span>
                <ResolutionStep label="Effective fallback" value={effectiveJudge?.name ?? "unavailable"} active tone="ok" />
              </div>
              <p className="mt-3 text-[10px] leading-4 text-fg-dim">Individual rubric definitions can still override this global fallback for a specific evaluation.</p>
            </div>
          </section>

          {db && (
            <section aria-labelledby="storage-title" className="card p-4 sm:p-5">
              <SectionTitle icon={Database} id="storage-title" title="Storage health" scope="Local SQLite" detail="Manual, explicit maintenance only—nothing here runs on a background timer." />
              <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StorageMetric label="Database" value={formatBytes(db.sizeBytes)} detail={`${db.pageCount.toLocaleString()} pages`} />
                <StorageMetric label="Write-ahead log" value={formatBytes(db.walBytes)} detail="bounded WAL journal" tone={db.walBytes > db.sizeBytes ? "warn" : undefined} />
                <StorageMetric label="Reclaimable" value={formatBytes(reclaimableBytes)} detail={`${db.freelistPages.toLocaleString()} free pages`} />
                <StorageMetric label="Records" value={totalRecords.toLocaleString()} detail={`${db.tables.runs} runs · ${db.tables.run_cases} cases`} />
              </div>
              <div className="mt-4 overflow-hidden rounded-full bg-bg-elev" aria-label="Database storage composition">
                <div className="flex h-2">
                  <span className="bg-accent" style={{ width: `${Math.max(2, db.sizeBytes / storageMax * 100)}%` }} />
                  <span className="bg-warn" style={{ width: `${db.walBytes / storageMax * 100}%` }} />
                  <span className="bg-fg-dim" style={{ width: `${db.shmBytes / storageMax * 100}%` }} />
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-fg-dim">
                <Legend color="bg-accent" label={`DB ${formatBytes(db.sizeBytes)}`} />
                <Legend color="bg-warn" label={`WAL ${formatBytes(db.walBytes)}`} />
                <Legend color="bg-fg-dim" label={`shared memory ${formatBytes(db.shmBytes)}`} />
              </div>
              <dl className="mt-4 grid gap-2 border-t border-bd-subtle pt-4 text-xs sm:grid-cols-2">
                <MiniFact label="Journal mode" value={db.journalMode.toUpperCase()} />
                <MiniFact label="Schema version" value={String(db.schemaVersion)} />
                <MiniFact label="Database path" value={db.path} wide />
                <MiniFact label="Events" value={db.tables.events.toLocaleString()} />
              </dl>

              {inventory && (
                <div className="mt-5 rounded-xl border border-bd-subtle bg-bg/40 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-fg-dim">Local data footprint</div>
                      <div className="mt-1 text-lg font-semibold mono">{formatBytes(inventory.totalBytes)}</div>
                    </div>
                    <span className={clsx("rounded bg-bg-elev px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em]", inventory.complete ? "text-ok" : "text-warn")}>
                      {inventory.complete ? "measured" : "lower bound"}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {inventory.entries.map((entry) => (
                      <div key={entry.id} className="rounded-lg border border-bd-subtle p-3">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-xs font-medium">{entry.label}</span>
                          <span className="text-xs font-semibold mono">{formatBytes(entry.bytes)}</span>
                        </div>
                        <div className="mt-1 text-[9px] text-fg-dim">
                          {entry.files.toLocaleString()} file{entry.files === 1 ? "" : "s"}{entry.directories ? ` · ${entry.directories.toLocaleString()} director${entry.directories === 1 ? "y" : "ies"}` : ""} · {entry.status === "partial" ? "partial / lower bound" : entry.status === "missing" ? "not present" : "measured"}
                        </div>
                        <p className="mt-2 text-[10px] leading-4 text-fg-dim">{entry.retention}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 border-t border-bd-subtle pt-3 text-[10px] leading-4 text-fg-dim">
                    Read-only filesystem metadata inventory; file contents are not opened. A lower-bound total means an entry cap, depth cap, or filesystem error prevented a complete measurement. Raw transcripts remain retained.
                  </p>
                </div>
              )}

              <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <MaintenanceButton icon={Stethoscope} label="Quick check" detail="Fast integrity scan" busy={maintenanceBusy === "quick_check"} disabled={Boolean(maintenanceBusy)} onClick={() => void runMaintenance("quick_check")} />
                <MaintenanceButton icon={ShieldCheck} label="Full check" detail="Exhaustive integrity" busy={maintenanceBusy === "integrity_check"} disabled={Boolean(maintenanceBusy)} onClick={() => void runMaintenance("integrity_check")} />
                <MaintenanceButton icon={RefreshCw} label="Checkpoint WAL" detail="Flush and truncate log" busy={maintenanceBusy === "checkpoint"} disabled={Boolean(maintenanceBusy)} onClick={() => void runMaintenance("checkpoint")} />
                <MaintenanceButton icon={Trash2} label="Vacuum" detail="Rewrite to reclaim pages" busy={maintenanceBusy === "vacuum"} disabled={Boolean(maintenanceBusy)} tone="warn" onClick={() => setConfirmVacuum(true)} />
              </div>
              {confirmVacuum && (
                <div className="mt-3 flex flex-col gap-3 rounded-xl border border-warn/25 bg-warn/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-fg-muted"><span className="font-medium text-warn">Vacuum rewrites the database.</span> It may briefly block writes; current reclaimable space is {formatBytes(reclaimableBytes)}.</p>
                  <div className="flex shrink-0 gap-2">
                    <button type="button" onClick={() => setConfirmVacuum(false)} className="min-h-10 rounded-lg border border-bd px-3 text-xs text-fg-muted hover:bg-bg-elev focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Cancel</button>
                    <button type="button" onClick={() => void runMaintenance("vacuum")} disabled={Boolean(maintenanceBusy)} aria-busy={maintenanceBusy === "vacuum"} className="min-h-10 rounded-lg bg-warn px-3 text-xs font-medium text-bg hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-50">Run vacuum</button>
                  </div>
                </div>
              )}
              {maintenanceNotice && <div role="status" className="mt-3 flex items-center gap-2 rounded-lg border border-ok/20 bg-ok/5 p-3 text-xs text-ok"><CheckCircle2 aria-hidden="true" className="size-3.5" /> {maintenanceNotice}</div>}
            </section>
          )}
        </main>

        <aside className="space-y-5 xl:sticky xl:top-4">
          <section aria-labelledby="privacy-title" className="card p-4">
            <SectionTitle icon={ShieldCheck} id="privacy-title" title="Privacy" scope="Immediate" detail="Hide local usernames and home-directory paths throughout the UI." />
            <Switch id="path-redaction" label="Redact local paths" description="Raw local files remain on this machine either way." checked={redact} onChange={setRedact} />
          </section>

          <section aria-labelledby="experience-title" className="card p-4">
            <SectionTitle icon={PlayCircle} id="experience-title" title="Guidance" scope="This browser" detail="Replay the first-run product tour without changing your data." />
            <button type="button" onClick={replayTour} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-bd text-sm text-fg-muted hover:bg-bg-elev hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              <PlayCircle aria-hidden="true" className="size-4" /> Replay welcome tour
            </button>
          </section>

          <section aria-labelledby="persistence-title" className="card p-4">
            <SectionTitle icon={Database} id="persistence-title" title="Persistence" scope="Explicit saves" detail="Know exactly where each setting lives." />
            <dl className="mt-4 space-y-3 text-xs">
              <MiniFact label="Run defaults" value="browser localStorage" />
              <MiniFact label="Judge backend" value="data/settings.json" />
              <MiniFact label="Privacy" value="browser localStorage" />
              <MiniFact label="Database" value={db ? `${formatBytes(db.sizeBytes)} on disk` : "local SQLite"} />
            </dl>
          </section>
        </aside>
      </div>

      <div className="relative z-10 mt-5 rounded-xl border border-bd bg-bg-subtle/95 p-3 shadow-2xl backdrop-blur supports-[backdrop-filter]:bg-bg-subtle/85 sm:sticky sm:bottom-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-medium">{dirty ? `Unsaved: ${dirtyScopes.join(" and ")}` : savedNotice ?? "All saved settings are up to date."}</div>
            <div className="mt-0.5 text-[10px] text-fg-dim">Privacy changes apply immediately and are not part of Save.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {confirmReset ? (
              <>
                <button type="button" onClick={() => setConfirmReset(false)} disabled={saving} className="min-h-10 rounded-lg border border-bd px-3 text-xs text-fg-muted hover:bg-bg-elev focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Cancel reset</button>
                <button type="button" onClick={() => void resetDefaultsAndJudge()} disabled={saving} className="flex min-h-10 items-center gap-2 rounded-lg border border-err/30 bg-err/10 px-3 text-xs font-medium text-err hover:bg-err/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
                  {saving ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : <RotateCcw aria-hidden="true" className="size-3.5" />} Confirm reset
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmReset(true)} disabled={saving || loading || !settingsReady} className="flex min-h-10 items-center gap-2 rounded-lg border border-bd px-3 text-xs text-fg-muted hover:bg-bg-elev focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
                <RotateCcw aria-hidden="true" className="size-3.5" /> Reset defaults & judge
              </button>
            )}
            <button type="button" onClick={() => void save()} disabled={saving || loading || !settingsReady || !dirty} className="flex min-h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-45">
              {saving ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : savedNotice ? <Check aria-hidden="true" className="size-4" /> : <Save aria-hidden="true" className="size-4" />}
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, id, title, scope, detail, dirty }: { icon: typeof Wrench; id: string; title: string; scope: string; detail: string; dirty?: boolean }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-7 place-items-center rounded-lg bg-accent/10"><Icon aria-hidden="true" className="size-3.5 text-accent-soft" /></span>
        <h2 id={id} className="text-sm font-semibold">{title}</h2>
        <span className="rounded bg-bg-elev px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-fg-dim">{scope}</span>
        {dirty && <span className="ml-auto rounded bg-warn/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-warn">unsaved</span>}
      </div>
      <p className="mt-1.5 text-[11px] leading-4 text-fg-dim">{detail}</p>
    </div>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.12em] text-fg-muted">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-[10px] leading-4 text-fg-dim">{hint}</p>}
    </div>
  );
}

function Switch({ id, label, description, checked, onChange }: { id: string; label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="mt-4 flex items-center justify-between gap-4">
      <div>
        <label id={`${id}-label`} htmlFor={id} className="text-sm font-medium">{label}</label>
        <p id={`${id}-description`} className="mt-0.5 text-[10px] leading-4 text-fg-dim">{description}</p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-description`}
        onClick={() => onChange(!checked)}
        className={clsx("relative h-7 w-12 shrink-0 rounded-full border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent", checked ? "border-accent bg-accent" : "border-bd bg-bg-elev")}
      >
        <span aria-hidden="true" className={clsx("absolute top-1 size-[18px] rounded-full bg-white shadow-sm transition-transform", checked ? "left-1 translate-x-5" : "left-1")} />
      </button>
    </div>
  );
}

function Summary({ icon: Icon, label, value, detail, tone }: { icon: typeof Wrench; label: string; value: string; detail: string; tone?: "ok" | "warn" }) {
  return (
    <div className="min-w-0 border-b border-r border-bd-subtle p-3.5 last:border-r-0 lg:border-b-0">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-fg-dim">
        <Icon aria-hidden="true" className={clsx("size-3.5", tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-accent-soft")} /> {label}
      </div>
      <div className={clsx("mt-1 truncate text-sm font-semibold mono", tone === "warn" && "text-warn")}>{value}</div>
      <div className="mt-0.5 truncate text-[10px] text-fg-dim">{detail}</div>
    </div>
  );
}

function ResolutionStep({ label, value, active, tone }: { label: string; value: string; active?: boolean; tone?: "ok" | "warn" }) {
  return (
    <div className={clsx("min-w-0 rounded-lg border p-3", active ? tone === "warn" ? "border-warn/30 bg-warn/5" : tone === "ok" ? "border-ok/25 bg-ok/5" : "border-accent/25 bg-accent/5" : "border-bd-subtle bg-bg")}>
      <div className="text-[9px] font-medium uppercase tracking-[0.12em] text-fg-dim">{label}</div>
      <div className="mt-1 break-words text-[10px] mono text-fg-muted">{value}</div>
    </div>
  );
}

function StorageMetric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: "warn" }) {
  return (
    <div className="rounded-xl border border-bd-subtle bg-bg/40 p-3">
      <div className="text-[9px] font-medium uppercase tracking-[0.12em] text-fg-dim">{label}</div>
      <div className={clsx("mt-1 text-base font-semibold mono", tone === "warn" && "text-warn")}>{value}</div>
      <div className="mt-0.5 text-[9px] text-fg-dim">{detail}</div>
    </div>
  );
}

function MaintenanceButton({ icon: Icon, label, detail, busy, disabled, onClick, tone }: { icon: typeof Wrench; label: string; detail: string; busy: boolean; disabled: boolean; onClick: () => void; tone?: "warn" }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={clsx("min-h-16 rounded-xl border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50", tone === "warn" ? "border-warn/20 hover:bg-warn/5" : "border-bd-subtle hover:bg-bg-elev")}>
      <span className="flex items-center gap-2 text-xs font-medium">
        {busy ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin text-accent-soft" /> : <Icon aria-hidden="true" className={clsx("size-3.5", tone === "warn" ? "text-warn" : "text-accent-soft")} />}
        {busy ? "Working…" : label}
      </span>
      <span className="mt-1 block text-[9px] text-fg-dim">{detail}</span>
    </button>
  );
}

function MiniFact({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={clsx("flex min-w-0 items-baseline justify-between gap-3", wide && "sm:col-span-2")}>
      <dt className="shrink-0 text-fg-dim">{label}</dt>
      <dd className="min-w-0 break-all text-right mono text-fg-muted">{value}</dd>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={clsx("size-2 rounded-full", color)} /> {label}</span>;
}

function same(a: object, b: object): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function formatBytes(value: unknown): string {
  const bytes = typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = bytes;
  let unit = -1;
  do {
    amount /= 1024;
    unit += 1;
  } while (amount >= 1024 && unit < units.length - 1);
  return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}
