"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { JudgeSelectionInput } from "@/lib/grader/selection";

type JudgeChoice = {
  id: string;
  label: string;
  model: string;
  effort: string | null;
  selection: { readiness: string; readinessDetail?: string };
};
type JudgeReadiness = { readiness: "checking" | "ready" | "error" | "unavailable"; detail: string };
type PickerLoadState = "checking" | "ready" | "error";

const FALLBACK_CHOICE: JudgeChoice = {
  id: "codex",
  label: "Codex subscription",
  model: "gpt-5.6-luna",
  effort: "high",
  selection: { readiness: "unknown" },
};

export default function JudgePicker({ value, onChange, onReadinessChange, error, idPrefix = "judge" }: { value: JudgeSelectionInput; onChange: (next: JudgeSelectionInput) => void; onReadinessChange?: (next: JudgeReadiness) => void; error?: string; idPrefix?: string }) {
  const [choices, setChoices] = useState<JudgeChoice[]>([]);
  const [loadState, setLoadState] = useState<PickerLoadState>("checking");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setLoadState("checking");
    setLoadError(null);
    fetch("/api/judges", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Judge sources could not be checked (HTTP ${res.status}).`);
        const body = await res.json() as { sources?: unknown };
        if (!Array.isArray(body.sources)) throw new Error("Judge sources returned an invalid readiness response.");
        return body.sources as JudgeChoice[];
      })
      .then((nextChoices) => {
        if (!live) return;
        setChoices(nextChoices);
        setLoadState("ready");
      })
      .catch((cause: unknown) => {
        if (!live || (cause instanceof DOMException && cause.name === "AbortError")) return;
        setChoices([]);
        setLoadState("error");
        setLoadError(cause instanceof Error ? cause.message : "Judge readiness could not be checked.");
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [reloadToken]);

  const sourceValue = value.source ?? FALLBACK_CHOICE.id;
  const selected = choices.find((choice) => choice.id === sourceValue);
  const unknownSelected: JudgeChoice | undefined = !selected && value.source
    ? {
      id: value.source,
      label: value.source,
      model: value.model ?? "",
      effort: null,
      selection: { readiness: "unavailable", readinessDetail: "This judge source is not in the current registry." },
    }
    : undefined;
  const optionChoices = choices.length
    ? unknownSelected ? [unknownSelected, ...choices] : choices
    : unknownSelected && unknownSelected.id !== FALLBACK_CHOICE.id ? [unknownSelected, FALLBACK_CHOICE] : [FALLBACK_CHOICE];
  const model = value.model ?? selected?.model ?? unknownSelected?.model ?? "";
  const sourceReadiness = selected?.selection.readiness ?? unknownSelected?.selection.readiness;
  const readiness: JudgeReadiness["readiness"] = loadState === "checking"
    ? "checking"
    : loadState === "error"
      ? "error"
      : sourceReadiness === "ready"
        ? "ready"
        : "unavailable";
  const detail = loadState === "checking"
    ? "Checking judge readiness…"
    : loadState === "error"
      ? loadError ?? "Judge readiness could not be checked."
      : selected?.selection.readinessDetail ?? unknownSelected?.selection.readinessDetail ?? "This judge source is unavailable.";
  const statusLabel = readiness === "ready" ? "Ready" : readiness === "checking" ? "Checking" : readiness === "error" ? "Error" : "Unavailable";
  const statusTone = readiness === "ready" ? "text-ok" : readiness === "error" ? "text-err" : readiness === "unavailable" ? "text-warn" : "text-fg-dim";

  useEffect(() => {
    onReadinessChange?.({ readiness, detail });
  }, [detail, onReadinessChange, readiness]);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <label className="block min-w-0 text-[11px] uppercase tracking-wider text-fg-muted" htmlFor={`${idPrefix}-source`}>
          Judge source
          <select id={`${idPrefix}-source`} value={sourceValue} onChange={(event) => { const choice = choices.find((item) => item.id === event.target.value); onChange({ ...value, source: event.target.value, model: choice?.model ?? "", reasoningEffort: choice?.effort ?? null }); }} className="mt-1.5 min-h-11 min-w-0 w-full rounded-md border border-bd bg-bg px-3 text-sm outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent">
            {optionChoices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label} · {choice.id}</option>)}
          </select>
        </label>
        <label className="block min-w-0 text-[11px] uppercase tracking-wider text-fg-muted" htmlFor={`${idPrefix}-model`}>
          Judge model
          <input id={`${idPrefix}-model`} value={model} onChange={(event) => onChange({ ...value, model: event.target.value })} spellCheck={false} className="mt-1.5 min-h-11 min-w-0 w-full rounded-md border border-bd bg-bg px-3 text-sm mono outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent" />
        </label>
      </div>
      {sourceValue === "codex" && <label className="block w-full max-w-sm text-[11px] uppercase tracking-wider text-fg-muted" htmlFor={`${idPrefix}-effort`}>
        Reasoning effort
        <select id={`${idPrefix}-effort`} value={value.reasoningEffort ?? selected?.effort ?? "high"} onChange={(event) => onChange({ ...value, reasoningEffort: event.target.value })} className="mt-1.5 min-h-11 w-full rounded-md border border-bd bg-bg px-3 text-sm mono outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"><option value="medium">medium</option><option value="high">high</option><option value="xhigh">xhigh</option></select>
      </label>}
      <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] ${statusTone}`} role={readiness === "error" ? "alert" : "status"} aria-live="polite" data-judge-readiness={readiness}>
        <span className="font-medium">{statusLabel}</span>
        <span className="min-w-0 break-words">· {detail}</span>
        {(readiness === "error" || readiness === "unavailable") && (
          <button
            type="button"
            onClick={() => setReloadToken((token) => token + 1)}
            disabled={loadState === "checking"}
            aria-label="Retry judge readiness check"
            className="inline-flex min-h-9 items-center gap-1 rounded-md border border-current/30 px-2 py-1 font-medium hover:bg-bg-elev focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            <RefreshCw className="size-3" /> Retry
          </button>
        )}
      </div>
      {error && <div role="alert" className="text-[11px] text-err">{error}</div>}
    </div>
  );
}
