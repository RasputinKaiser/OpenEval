"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { AlertCircle, CheckCircle2, PlayCircle, RotateCcw, Save, Settings as SettingsIcon, Stethoscope } from "lucide-react";
import PageHeader from "./PageHeader";
import HarnessPicker from "./HarnessPicker";
import ModelPicker from "./ModelPicker";
import { useRedaction } from "@/lib/use-redaction";
import { ONBOARDING_DISMISSED_KEY, SHOW_ONBOARDING_EVENT } from "./first-run-steps";

/**
 * Run defaults consumed by NewRunClient when creating a run (URL params win).
 * Kept in browser storage because these are per-browser form preferences.
 */
export const RUN_DEFAULTS_KEY = "openeval-settings";

const DEFAULTS = {
  defaultHarness: "",
  defaultModel: "",
  defaultParallel: 1,
  defaultSamples: 1,
};

type Settings = typeof DEFAULTS;
type JudgeSettings = { judgeSource: string; judgeModel: string };
type EffectiveJudge = { source: string; model: string; name: string };
type EnvironmentOverrides = { source: boolean; model: boolean; openrouterKey: boolean };
type EnvironmentOverrideValues = { judgeHarness: string | null; judgeModel: string | null };
type HarnessOption = { id: string; label: string; status: string };

/** Safe display boundary: maintenance stats are untrusted JSON — never hand objects to JSX children. */
function displayStat(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") {
    try {
      const s = JSON.stringify(v);
      return s.length > 140 ? `${s.slice(0, 140)}…` : s;
    } catch {
      return "[unrenderable]";
    }
  }
  return String(v);
}

export function readRunDefaults(): Settings {
  try {
    const stored = localStorage.getItem(RUN_DEFAULTS_KEY);
    if (stored) return { ...DEFAULTS, ...JSON.parse(stored) };
  } catch {}
  return { ...DEFAULTS };
}
export default function SettingsClient() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [judge, setJudge] = useState<JudgeSettings>({ judgeSource: "", judgeModel: "" });
  const [effectiveJudge, setEffectiveJudge] = useState<EffectiveJudge | null>(null);
  const [environmentOverrides, setEnvironmentOverrides] = useState<EnvironmentOverrides>({ source: false, model: false, openrouterKey: false });
  const [environmentOverrideValues, setEnvironmentOverrideValues] = useState<EnvironmentOverrideValues>({ judgeHarness: null, judgeModel: null });
  const [maintenance, setMaintenance] = useState<Record<string, unknown> | null>(null);
  const [harnessOptions, setHarnessOptions] = useState<HarnessOption[]>([]);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { redact, setRedact } = useRedaction();

  useEffect(() => {
    setSettings(readRunDefaults());
    Promise.all([
      fetch("/api/settings").then(async (r) => {
        if (!r.ok) throw new Error(`Settings unavailable (${r.status})`);
        return r.json() as Promise<{ settings: JudgeSettings; effectiveJudge: EffectiveJudge; environmentOverrides: EnvironmentOverrides; environmentOverrideValues?: EnvironmentOverrideValues }>;
      }),
      fetch("/api/harnesses").then(async (r) => {
        if (!r.ok) throw new Error(`Harness registry unavailable (${r.status})`);
        return r.json() as Promise<{ harnesses?: HarnessOption[] }>;
      }),
    ])
      .then(([settingsResponse, harnessResponse]) => {
        setJudge({ judgeSource: settingsResponse.settings?.judgeSource ?? "", judgeModel: settingsResponse.settings?.judgeModel ?? "" });
        setEffectiveJudge(settingsResponse.effectiveJudge ?? null);
        setEnvironmentOverrides(settingsResponse.environmentOverrides ?? { source: false, model: false, openrouterKey: false });
        setEnvironmentOverrideValues(settingsResponse.environmentOverrideValues ?? { judgeHarness: null, judgeModel: null });
        setHarnessOptions((harnessResponse.harnesses ?? []).map((h) => ({ id: h.id, label: h.label, status: h.status })));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  // Diagnostics (maintenance stats) is optional server surface — feature-detect
  // it so Settings works identically on servers that don't expose it yet.
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/settings/maintenance", { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) return null;
        const d: unknown = await r.json().catch(() => null);
        return d && typeof d === "object" && !Array.isArray(d) ? (d as Record<string, unknown>) : null;
      })
      .then((d) => { if (d && Object.keys(d).length > 0) setMaintenance(d); })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  function replayTour() {
    try { localStorage.removeItem(ONBOARDING_DISMISSED_KEY); } catch {}
    window.dispatchEvent(new Event(SHOW_ONBOARDING_EVENT));
  }

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  function updateJudge<K extends keyof JudgeSettings>(key: K, value: JudgeSettings[K]) {
    setJudge((s) => ({ ...s, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      localStorage.setItem(RUN_DEFAULTS_KEY, JSON.stringify(settings));
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(judge),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Could not save judge settings (${response.status})`);
      setJudge(payload.settings ?? judge);
      setEffectiveJudge(payload.effectiveJudge ?? null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSettings({ ...DEFAULTS });
    setJudge({ judgeSource: "", judgeModel: "" });
    try { localStorage.removeItem(RUN_DEFAULTS_KEY); } catch {}
    setError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ judgeSource: "", judgeModel: "" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Could not reset settings (${response.status})`);
      setEffectiveJudge(payload.effectiveJudge ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const sourceOptions = harnessOptions.filter((h) => h.id !== "openrouter");
  const selectedSource = sourceOptions.find((h) => h.id === judge.judgeSource);
  const staleSource = judge.judgeSource && judge.judgeSource !== "openrouter" && !selectedSource;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <PageHeader icon={SettingsIcon} title="Settings" subtitle="Choose local run defaults and the backend used for LLM judging." />

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-err/30 bg-err/5 px-3 py-2.5 text-sm text-err">
          <AlertCircle className="size-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <section className="space-y-4">
        <div className="card p-5">
          <h2 className="text-sm font-medium mb-1">Run defaults</h2>
          <p className="text-[11px] text-fg-dim mb-4">These pre-fill New Run in this browser. Explicit URL parameters, such as re-run links, still take precedence.</p>
          <div className="space-y-3">
            <Field label="Default harness">
              <HarnessPicker value={settings.defaultHarness || undefined} onChange={(v) => update("defaultHarness", v ?? "")} />
            </Field>
            <Field label="Default model">
              <ModelPicker value={settings.defaultModel || undefined} onChange={(v) => update("defaultModel", v ?? "")} harness={settings.defaultHarness || undefined} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Default parallel">
                <input type="number" min={1} max={8} value={settings.defaultParallel} onChange={(e) => update("defaultParallel", Math.max(1, Math.min(8, Number(e.target.value) || 1)))} className="w-full px-3 py-2 text-sm bg-bg border border-bd rounded-md mono focus:outline-none focus:border-accent" />
              </Field>
              <Field label="Default samples">
                <input type="number" min={1} max={8} value={settings.defaultSamples} onChange={(e) => update("defaultSamples", Math.max(1, Math.min(8, Number(e.target.value) || 1)))} className="w-full px-3 py-2 text-sm bg-bg border border-bd rounded-md mono focus:outline-none focus:border-accent" />
              </Field>
            </div>
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-start justify-between gap-3 mb-1">
            <div>
              <h2 className="text-sm font-medium">LLM judge</h2>
              <p className="text-[11px] text-fg-dim mt-1">Used by rubric graders and the optional Timeline outcome-judge pass. Saved locally in <span className="mono">data/settings.json</span>.</p>
            </div>
            {loading ? <span className="text-[10px] text-fg-dim mono">loading…</span> : null}
          </div>

          <div className="space-y-3 mt-4">
            <Field label="Judge source">
              <select value={judge.judgeSource} onChange={(e) => updateJudge("judgeSource", e.target.value)} className="w-full px-3 py-2 text-sm bg-bg border border-bd rounded-md mono focus:outline-none focus:border-accent">
                <option value="">Auto (environment, then OpenRouter/Codex)</option>
                <option value="openrouter">OpenRouter HTTP backend{environmentOverrides.openrouterKey ? " · key detected" : " · no key detected"}</option>
                {sourceOptions.map((h) => <option key={h.id} value={h.id}>{h.label} ({h.id}){h.status !== "available" ? ` · ${h.status}` : ""}</option>)}
                {staleSource ? <option value={judge.judgeSource}>{judge.judgeSource} · saved custom source</option> : null}
              </select>
              <p className="text-[10px] text-fg-dim mt-1.5">OpenRouter is an HTTP provider; any registered harness can be used as a local CLI judge. Environment variables override this selection when set.</p>
            </Field>
            <Field label="Judge model">
              <ModelPicker value={judge.judgeModel || undefined} onChange={(v) => updateJudge("judgeModel", v ?? "")} harness={judge.judgeSource && judge.judgeSource !== "openrouter" ? judge.judgeSource : undefined} />
              <p className="text-[10px] text-fg-dim mt-1.5">Pick a discovered alias or enter any provider model id in the picker. Leave default to use the selected source&apos;s safe default.</p>
            </Field>
          </div>

          {effectiveJudge && (
            <div className="mt-4 rounded-md border border-bd-subtle bg-bg px-3 py-2.5">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-fg-muted">
                <CheckCircle2 className="size-3.5 text-ok" /> Effective judge
              </div>
              <div className="mono text-sm mt-1">{effectiveJudge.name}</div>
              <p className="text-[10px] text-fg-dim mt-1">This is what rubric graders will actually call right now, after environment variables and saved settings are combined.</p>
              {(environmentOverrides.source || environmentOverrides.model) && (
                <div className="mt-2 space-y-1">
                  {environmentOverrides.source && (
                    <div className="text-[10px] text-warn mono break-all">JUDGE_HARNESS={environmentOverrideValues.judgeHarness ?? ""} — this environment variable overrides the saved judge source until it is unset.</div>
                  )}
                  {environmentOverrides.model && (
                    <div className="text-[10px] text-warn mono break-all">JUDGE_MODEL={environmentOverrideValues.judgeModel ?? ""} — this environment variable overrides the saved judge model until it is unset.</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="text-sm font-medium mb-1">Privacy</h2>
          <p className="text-[11px] text-fg-dim mb-4">Hides your username and home-directory paths everywhere in the UI — the same app-wide toggle shown on Live, Collection, and transcript pages. Applies immediately; raw paths never leave this machine either way.</p>
          <Toggle label="Redact local usernames and paths" checked={redact} onChange={setRedact} />
        </div>

        <div className="card p-5">
          <h2 className="text-sm font-medium mb-1">Welcome tour</h2>
          <p className="text-[11px] text-fg-dim mb-3">Show the first-run introduction again on this browser. Dismissing it hides it until you replay it here.</p>
          <button onClick={replayTour} className="flex items-center gap-2 px-3 py-2 rounded-md border border-bd text-sm text-fg-muted hover:bg-bg-elev transition-colors">
            <PlayCircle className="size-4" /> Replay welcome tour
          </button>
        </div>

        {maintenance && (
          <div className="card p-5">
            <h2 className="text-sm font-medium mb-1 flex items-center gap-1.5"><Stethoscope className="size-3.5 text-accent-soft" /> Diagnostics</h2>
            <p className="text-[11px] text-fg-dim mb-4">Read-only maintenance statistics reported by this server.</p>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
              {Object.entries(maintenance).slice(0, 24).map(([key, value]) => (
                <div key={key} className="flex items-baseline justify-between gap-3 min-w-0">
                  <dt className="text-[11px] text-fg-muted truncate shrink-0 max-w-[55%]" title={key}>{key}</dt>
                  <dd className="text-xs mono text-right break-all min-w-0">{displayStat(value)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving || loading} className="flex items-center gap-2 px-4 py-2.5 rounded-md bg-accent hover:bg-accent/90 disabled:opacity-50 active:scale-[0.96] text-white text-sm font-medium transition-colors">
            <Save className="size-4" /> {saving ? "Saving…" : "Save settings"}
          </button>
          <button onClick={reset} disabled={saving} className="flex items-center gap-2 px-4 py-2.5 rounded-md border border-bd text-sm text-fg-muted hover:bg-bg-elev disabled:opacity-50 transition-colors">
            <RotateCcw className="size-4" /> Reset all
          </button>
          {saved && <span className="text-sm text-ok">Saved.</span>}
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-wider text-fg-muted block mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-sm text-fg-muted">{label}</span>
      <button type="button" onClick={() => onChange(!checked)} className={clsx("relative w-10 h-5 rounded-full transition-colors", checked ? "bg-accent" : "bg-bg-elev")}>
        <span className={clsx("absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform", checked && "translate-x-5")} />
      </button>
    </label>
  );
}
