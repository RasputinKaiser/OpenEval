"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play, Check, Filter, Cpu } from "lucide-react";
import clsx from "clsx";
import type { CaseDefinition } from "@/lib/types";
import ModelPicker from "./ModelPicker";

interface Props { cases: CaseDefinition[]; }

const CATEGORIES = ["agentic-swe", "single-tool", "reasoning"] as const;

export default function NewRunClient({ cases }: Props) {
  const router = useRouter();
  const [runner, setRunner] = useState<"headless" | "tmux">("headless");
  const [parallel, setParallel] = useState(1);
  const [samples, setSamples] = useState(1);
  const [name, setName] = useState("");
  const [model, setModel] = useState<string | undefined>("glm-5.2");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [filterCats, setFilterCats] = useState<Set<string>>(new Set(cases.map((c) => c.category)));
  const [filterDiff, setFilterDiff] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allTags = Array.from(new Set(cases.flatMap((c) => c.tags ?? []))).sort();
  const [filterTags, setFilterTags] = useState<Set<string>>(new Set());

  const visible = cases.filter((c) => filterCats.has(c.category) && (!filterDiff.size || filterDiff.has(c.difficulty || "untiered")) && (!filterTags.size || (c.tags ?? []).some((t) => filterTags.has(t))));
  const allSelected = visible.length > 0 && visible.every((c) => selected[c.id]);
  const selectedCount = Object.values(selected).filter(Boolean).length;

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

  async function submit() {
    setSubmitting(true);
    setError(null);
    const useSelection = selectedCount > 0;
    const caseIds = useSelection ? Object.entries(selected).filter(([, v]) => v).map(([k]) => k) : undefined;
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || undefined,
          runner,
          parallel,
          samples,
          model,
          caseIds,
          categories: useSelection ? undefined : Array.from(filterCats),
          tags: useSelection ? undefined : Array.from(filterTags),
          difficulty: useSelection ? undefined : Array.from(filterDiff),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to start run (${res.status})`);
      }
      const data = await res.json();
      router.push(`/runs/${data.id}`);
    } catch (e: any) {
      setError(String(e?.message || e));
      setSubmitting(false);
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">New Run</h1>
        <p className="text-sm text-fg-muted mt-1">Configure and start a fresh evaluation run.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4">

          <section className="card p-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] uppercase tracking-wider text-fg-muted">Run name (optional)</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={`Run ${new Date().toLocaleString()}`}
                  className="mt-1.5 w-full px-3 py-2 text-sm bg-bg border border-bd rounded-md focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-fg-muted">Parallel workers</label>
                <input
                  type="number" min={1} max={8} value={parallel}
                  onChange={(e) => setParallel(Math.max(1, Math.min(8, parseInt(e.target.value) || 1)))}
                  className="mt-1.5 w-full px-3 py-2 text-sm bg-bg border border-bd rounded-md mono focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-fg-muted">Samples (pass@k)</label>
                <input
                  type="number" min={1} max={8} value={samples}
                  onChange={(e) => setSamples(Math.max(1, Math.min(8, parseInt(e.target.value) || 1)))}
                  className="mt-1.5 w-full px-3 py-2 text-sm bg-bg border border-bd rounded-md mono focus:outline-none focus:border-accent"
                />
                <div className="text-[10px] text-fg-dim mt-1">Run each case k times · report pass@1, pass@k, pass^k</div>
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
            </div>

            <div className="mt-4">
              <label className="text-[11px] uppercase tracking-wider text-fg-muted">Model</label>
              <div className="mt-1.5">
                <ModelPicker value={model} onChange={setModel} />
              </div>
              <div className="text-[10px] text-fg-dim mt-1.5">Discovered from your Noumena Code profile. Leave default to let ncode pick.</div>
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

            <div className="px-4 py-2.5 border-b border-bd-subtle flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  onClick={() => toggleCat(c)}
                  className={clsx(
                    "text-[11px] px-2 py-1 rounded-md border mono",
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
                    "text-[11px] px-2 py-1 rounded-md border",
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
                    "text-[11px] px-2 py-1 rounded-md border",
                    filterTags.has(t) ? "border-accent bg-accent/10 text-accent-soft" : "border-bd text-fg-muted hover:bg-bg-elev"
                  )}
                >
                  #{t}
                </button>
              ))}
            </div>

            <div className="max-h-[400px] overflow-y-auto divide-y divide-bd-subtle">
              {visible.map((c) => {
                const sel = !!selected[c.id];
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelected({ ...selected, [c.id]: !sel })}
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
            <div className="text-xs text-fg-muted mb-3">Run summary</div>
            <dl className="space-y-2 text-sm">
              <Row label="Cases" value={samples > 1 ? `${visible.length} × ${samples} = ${visible.length * samples}` : `${visible.length} (filtered)`} />
              <Row label="Runner" value={runner} />
              <Row label="Model" value={model || "default"} />
              <Row label="Parallel" value={`${parallel}×`} />
              <Row label="Samples" value={samples > 1 ? `${samples} (pass@k)` : "1"} />
            </dl>
            <button
              onClick={submit}
              disabled={submitting || (selectedCount === 0 && visible.length === 0)}
              className="mt-4 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-md bg-accent hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium"
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              {submitting ? "Starting…" : "Start run"}
            </button>
            {error && <div className="mt-2 text-[11px] text-err">{error}</div>}
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