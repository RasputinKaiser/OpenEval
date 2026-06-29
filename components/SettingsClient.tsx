"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Save, RotateCcw } from "lucide-react";

const DEFAULTS = {
  defaultHarness: "ncode",
  defaultModel: "glm-5.2",
  defaultParallel: 1,
  defaultSamples: 1,
  pollInterval: 1500,
  itemsPerPage: 50,
  redactPaths: true,
  staggerAnimations: true,
};

type Settings = typeof DEFAULTS;

export default function SettingsClient() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("neval-settings");
      if (stored) setSettings({ ...DEFAULTS, ...JSON.parse(stored) });
    } catch {}
  }, []);

  function save() {
    try { localStorage.setItem("neval-settings", JSON.stringify(settings)); } catch {}
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function reset() {
    setSettings(DEFAULTS);
    try { localStorage.removeItem("neval-settings"); } catch {}
  }

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-fg-muted mt-1">Configure dashboard defaults. Stored locally in your browser.</p>
      </header>

      <section className="space-y-4">
        <div className="card p-5">
          <h2 className="text-sm font-medium mb-4">Run defaults</h2>
          <div className="space-y-3">
            <Field label="Default harness">
              <select value={settings.defaultHarness} onChange={(e) => update("defaultHarness", e.target.value)} className="w-full px-3 py-2 text-sm bg-bg border border-bd rounded-md mono focus:outline-none focus:border-accent">
                <option value="ncode">ncode</option>
                <option value="claude-code">claude-code</option>
                <option value="codex">codex</option>
              </select>
            </Field>
            <Field label="Default model">
              <input value={settings.defaultModel} onChange={(e) => update("defaultModel", e.target.value)} className="w-full px-3 py-2 text-sm bg-bg border border-bd rounded-md mono focus:outline-none focus:border-accent" />
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
        </div>

        <div className="card p-5">
          <h2 className="text-sm font-medium mb-4">Dashboard preferences</h2>
          <div className="space-y-3">
            <Field label="Poll interval (ms)">
              <input type="number" min={500} step={500} value={settings.pollInterval} onChange={(e) => update("pollInterval", Number(e.target.value))} className="w-full px-3 py-2 text-sm bg-bg border border-bd rounded-md mono focus:outline-none focus:border-accent" />
            </Field>
            <Field label="Items per page">
              <select value={settings.itemsPerPage} onChange={(e) => update("itemsPerPage", Number(e.target.value))} className="w-full px-3 py-2 text-sm bg-bg border border-bd rounded-md mono focus:outline-none focus:border-accent">
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </Field>
            <Toggle label="Redact sensitive paths" checked={settings.redactPaths} onChange={(v) => update("redactPaths", v)} />
            <Toggle label="Stagger entrance animations" checked={settings.staggerAnimations} onChange={(v) => update("staggerAnimations", v)} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            className="flex items-center gap-2 px-4 py-2.5 rounded-md bg-accent hover:bg-accent/90 active:scale-[0.96] text-white text-sm font-medium transition-colors"
          >
            <Save className="size-4" /> Save settings
          </button>
          <button
            onClick={reset}
            className="flex items-center gap-2 px-4 py-2.5 rounded-md border border-bd text-sm text-fg-muted hover:bg-bg-elev transition-colors"
          >
            <RotateCcw className="size-4" /> Reset to defaults
          </button>
          {saved && <span className="text-sm text-ok">Saved!</span>}
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