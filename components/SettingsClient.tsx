"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Save, RotateCcw, Settings as SettingsIcon } from "lucide-react";
import PageHeader from "./PageHeader";
import { useRedaction } from "@/lib/use-redaction";

/**
 * Run defaults consumed by NewRunClient when creating a run (URL params win).
 * Kept intentionally small: every control on this page must actually do
 * something — placebo settings erode trust in an accuracy-focused tool.
 */
export const RUN_DEFAULTS_KEY = "openeval-settings";

const DEFAULTS = {
  defaultHarness: "",
  defaultModel: "",
  defaultParallel: 1,
  defaultSamples: 1,
};

type Settings = typeof DEFAULTS;

export function readRunDefaults(): Settings {
  try {
    const stored = localStorage.getItem(RUN_DEFAULTS_KEY);
    if (stored) return { ...DEFAULTS, ...JSON.parse(stored) };
  } catch {}
  return { ...DEFAULTS };
}

export default function SettingsClient() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [saved, setSaved] = useState(false);
  const [harnessOptions, setHarnessOptions] = useState<Array<{ id: string; label: string }>>([]);
  const { redact, setRedact } = useRedaction();

  useEffect(() => {
    setSettings(readRunDefaults());
    fetch("/api/harnesses")
      .then((r) => r.json())
      .then((d) => setHarnessOptions((d.harnesses ?? []).map((h: { id: string; label: string }) => ({ id: h.id, label: h.label }))))
      .catch(() => {});
  }, []);

  function save() {
    try { localStorage.setItem(RUN_DEFAULTS_KEY, JSON.stringify(settings)); } catch {}
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function reset() {
    setSettings(DEFAULTS);
    try { localStorage.removeItem(RUN_DEFAULTS_KEY); } catch {}
  }

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <PageHeader icon={SettingsIcon} title="Settings" subtitle="Configure dashboard defaults. Stored locally in your browser." />

      <section className="space-y-4">
        <div className="card p-5">
          <h2 className="text-sm font-medium mb-1">Run defaults</h2>
          <p className="text-[11px] text-fg-dim mb-4">Pre-filled on the New Run form. Explicit URL parameters (e.g. re-run links) take precedence.</p>
          <div className="space-y-3">
            <Field label="Default harness">
              <select value={settings.defaultHarness} onChange={(e) => update("defaultHarness", e.target.value)} className="w-full px-3 py-2 text-sm bg-bg border border-bd rounded-md mono focus:outline-none focus:border-accent">
                <option value="">(registry default)</option>
                {harnessOptions.map((h) => (
                  <option key={h.id} value={h.id}>{h.id}</option>
                ))}
              </select>
            </Field>
            <Field label="Default model">
              <input value={settings.defaultModel} onChange={(e) => update("defaultModel", e.target.value)} placeholder="(harness default)" className="w-full px-3 py-2 text-sm bg-bg border border-bd rounded-md mono focus:outline-none focus:border-accent" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Default parallel">
                <input type="number" min={1} max={8} value={settings.defaultParallel} onChange={(e) => update("defaultParallel", Number(e.target.value))} className="w-full px-3 py-2 text-sm bg-bg border border-bd rounded-md mono focus:outline-none focus:border-accent" />
              </Field>
              <Field label="Default samples">
                <input type="number" min={1} max={8} value={settings.defaultSamples} onChange={(e) => update("defaultSamples", Number(e.target.value))} className="w-full px-3 py-2 text-sm bg-bg border border-bd rounded-md mono focus:outline-none focus:border-accent" />
              </Field>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={save}
              className="flex items-center gap-2 px-4 py-2.5 rounded-md bg-accent hover:bg-accent/90 active:scale-[0.96] text-white text-sm font-medium transition-colors"
            >
              <Save className="size-4" /> Save run defaults
            </button>
            <button
              onClick={reset}
              className="flex items-center gap-2 px-4 py-2.5 rounded-md border border-bd text-sm text-fg-muted hover:bg-bg-elev transition-colors"
            >
              <RotateCcw className="size-4" /> Reset
            </button>
            {saved && <span className="text-sm text-ok">Saved!</span>}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="text-sm font-medium mb-1">Privacy</h2>
          <p className="text-[11px] text-fg-dim mb-4">The same app-wide toggle shown on Live, Collection, and transcript pages. Applies immediately.</p>
          <Toggle label="Redact local usernames and paths" checked={redact} onChange={setRedact} />
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
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={clsx("relative w-10 h-5 rounded-full transition-colors", checked ? "bg-accent" : "bg-bg-elev")}
      >
        <span className={clsx("absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform", checked && "translate-x-5")} />
      </button>
    </label>
  );
}
