"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  AlertCircle,
  ArrowUpRight,
  Braces,
  CheckCircle2,
  Database,
  Eye,
  FileJson,
  Gauge,
  Loader2,
  Plug,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Terminal,
  Upload,
  XCircle,
} from "lucide-react";
import type { DescriptorIssue } from "@/lib/adapters/schema";
import type { DiscoveredHarness } from "@/lib/adapters/discover";
import { cachedFetch, invalidateCache } from "@/lib/cached-fetch";
import { useRedactedShow } from "@/lib/use-redaction";
import CopyButton from "./run-detail/CopyButton";
import PageHeader from "./PageHeader";
import SystemNav from "./SystemNav";

type HarnessPayload = {
  harnesses: DiscoveredHarness[];
  defaultHarness: string;
  availableCount: number;
  descriptorIssues: DescriptorIssue[];
};

type ReadinessLayer = {
  id: "registration" | "binary" | "execution" | "observation" | "judge";
  label: string;
  state: "ready" | "partial" | "unavailable" | "unknown";
  summary: string;
  diagnostic: string;
  action: string;
};

type ConnectionHarness = DiscoveredHarness & {
  registration?: {
    provenance: "user-managed" | "user-override" | "bundled-reference";
    enabled: boolean;
    revision: string | null;
    file: string | null;
  };
  readiness?: ReadinessLayer[];
};

type NormalizedPreview = {
  descriptor: {
    id: string;
    label: string;
    binNames: string[];
    parser: string;
    prompt: { mode: string; flag?: string };
    liveTrace?: { format: string; roots: string[]; maxDepth?: number; inferredModel?: string };
    capabilities: { reportsCost: boolean; reportsTokens: boolean; reportsTurns: boolean; supportsVisionInput: boolean | null; permissionModes: string[] };
    models?: { aliases?: Array<{ id: string; label: string; family: string }>; default?: string };
  };
};

type Filter = "all" | "available" | "attention";

const STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
  available: { label: "Ready", cls: "border-ok/25 bg-ok/10 text-ok", dot: "bg-ok" },
  not_found: { label: "Not installed", cls: "border-bd bg-bg-elev text-fg-muted", dot: "bg-fg-dim" },
  error: { label: "Probe failed", cls: "border-err/25 bg-err/10 text-err", dot: "bg-err" },
};

export default function HarnessesClient() {
  const [payload, setPayload] = useState<HarnessPayload>({
    harnesses: [],
    defaultHarness: "",
    availableCount: 0,
    descriptorIssues: [],
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [probing, setProbing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [descriptorText, setDescriptorText] = useState("");
  const [descriptorPreview, setDescriptorPreview] = useState<NormalizedPreview | null>(null);
  const [descriptorError, setDescriptorError] = useState<string | null>(null);
  const [managing, setManaging] = useState<"preview" | "save" | "disconnect" | null>(null);
  const requestId = useRef(0);

  async function load(refresh = false) {
    const id = ++requestId.current;
    if (refresh) {
      setRefreshing(true);
      invalidateCache("/api/harnesses");
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const url = `/api/harnesses${refresh ? "?refresh=1" : ""}`;
      const next = refresh
        ? await fetch(url, { cache: "no-store" }).then(async (response) => {
            if (!response.ok) throw new Error(`Registry refresh failed (${response.status})`);
            return response.json() as Promise<HarnessPayload>;
          })
        : await cachedFetch<HarnessPayload>(url);
      if (id !== requestId.current) return;
      const harnesses = next.harnesses ?? [];
      setPayload({
        harnesses,
        defaultHarness: next.defaultHarness ?? "",
        availableCount: next.availableCount ?? harnesses.filter((h) => h.status === "available").length,
        descriptorIssues: next.descriptorIssues ?? [],
      });
      setSelected((current) => {
        const requested = current ?? readHarnessParam();
        const valid = requested && harnesses.some((h) => h.id === requested) ? requested : null;
        return valid ?? harnesses.find((h) => h.status === "available")?.id ?? harnesses[0]?.id ?? null;
      });
      if (refresh) setNotice(`Registry refreshed. ${harnesses.filter((h) => h.status === "available").length} harnesses ready.`);
    } catch (cause) {
      if (id === requestId.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  useEffect(() => {
    void load(false);
    // The request sequence guard prevents stale refreshes from overwriting a
    // newer registry response; initial discovery is intentionally mount-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const restore = () => { const requested = readHarnessParam(); setSelected(payload.harnesses.some((item) => item.id === requested) ? requested : payload.harnesses.find((item) => item.status === "available")?.id ?? payload.harnesses[0]?.id ?? null); };
    window.addEventListener("popstate", restore); return () => window.removeEventListener("popstate", restore);
  }, [payload.harnesses]);

  function choose(id: string) {
    setSelected(id);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("harness", id);
      window.history.pushState(window.history.state, "", url);
    } catch {}
  }

  async function probe(id: string) {
    setProbing(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/harnesses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message = body && typeof body === "object" && "error" in body ? String(body.error) : `Probe failed (${res.status})`;
        throw new Error(message);
      }
      const updated = body as DiscoveredHarness;
      invalidateCache("/api/harnesses");
      setPayload((current) => {
        const harnesses = current.harnesses.map((h) => (h.id === id ? updated : h));
        return { ...current, harnesses, availableCount: harnesses.filter((h) => h.status === "available").length };
      });
      setNotice(`${updated.label} probe completed: ${STATUS_META[updated.status]?.label ?? updated.status}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setProbing(null);
    }
  }

  async function previewDescriptor() {
    setManaging("preview");
    setDescriptorError(null);
    setDescriptorPreview(null);
    try {
      const response = await fetch("/api/harnesses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "validate", descriptor: descriptorText }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? `Descriptor validation failed (${response.status})`);
      setDescriptorPreview(body as NormalizedPreview);
    } catch (cause) {
      setDescriptorError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setManaging(null);
    }
  }

  async function saveDescriptor() {
    setManaging("save");
    setDescriptorError(null);
    try {
      const parsed = JSON.parse(descriptorText) as unknown;
      const existingId = typeof parsed === "object" && parsed !== null && "id" in parsed ? String(parsed.id) : "";
      const existing = payload.harnesses.find((h) => h.id === existingId) as ConnectionHarness | undefined;
      const response = await fetch("/api/harnesses", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descriptor: parsed, expectedRevision: existing?.registration?.revision ?? undefined }),
      });
      const body = await response.json().catch(() => null);
      if (response.status === 409) throw new Error(`${body?.error ?? "Descriptor changed elsewhere."} Refresh the registry, then review and retry.`);
      if (!response.ok) throw new Error(body?.error ?? `Connection failed (${response.status})`);
      setDescriptorPreview(null);
      setDescriptorText("");
      await load(true);
      setNotice(`${body?.descriptor?.label ?? existingId} connected and saved. Safe probes are still separate from provider readiness.`);
    } catch (cause) {
      setDescriptorError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setManaging(null);
    }
  }

  async function reconnect(id: string) {
    setNotice("Refreshing the saved descriptor, binary, and observation roots, then rerunning safe probes. No model request is sent.");
    await load(true);
    await probe(id);
  }

  async function disconnect(id: string) {
    const harness = payload.harnesses.find((item) => item.id === id) as ConnectionHarness | undefined;
    if (!harness || harness.registration?.provenance === "bundled-reference") return;
    setManaging("disconnect");
    setDescriptorError(null);
    try {
      const params = new URLSearchParams({ id });
      if (harness.registration?.revision) params.set("expectedRevision", harness.registration.revision);
      const response = await fetch(`/api/harnesses?${params.toString()}`, { method: "DELETE" });
      const body = await response.json().catch(() => null);
      if (response.status === 409) throw new Error(`${body?.error ?? "Descriptor changed elsewhere."} Refresh the registry before disconnecting.`);
      if (!response.ok) throw new Error(body?.error ?? `Disconnect failed (${response.status})`);
      await load(true);
      setNotice(body?.fallback === "bundled-reference"
        ? `${harness.label} disconnected. The bundled reference is visible again; saved evidence was preserved.`
        : `${harness.label} disconnected. Saved evidence was preserved.`);
    } catch (cause) {
      setDescriptorError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setManaging(null);
    }
  }

  function loadTemplate() {
    setDescriptorText(JSON.stringify({
      id: "my-harness",
      label: "My Harness",
      binNames: ["my-harness"],
      parser: "text",
      argTemplate: ["{prompt}"],
      prompt: { mode: "arg" },
      capabilities: { reportsCost: false, reportsTokens: false, reportsTurns: false },
      liveTrace: { format: "jsonl-dir", roots: ["~/.my-harness/sessions"] },
    }, null, 2));
    setDescriptorError(null);
    setDescriptorPreview(null);
  }

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return payload.harnesses.filter((h) => {
      if (filter === "available" && h.status !== "available") return false;
      if (filter === "attention" && h.status === "available") return false;
      return !normalized
        || h.id.toLowerCase().includes(normalized)
        || h.label.toLowerCase().includes(normalized)
        || h.version?.toLowerCase().includes(normalized);
    });
  }, [filter, payload.harnesses, query]);

  const active = payload.harnesses.find((h) => h.id === selected) ?? payload.harnesses[0];
  const fullTelemetry = payload.harnesses.filter(
    (h) => h.capabilities.reportsCost && h.capabilities.reportsTokens && h.capabilities.reportsTurns,
  ).length;
  const transcriptSources = payload.harnesses.filter((h) => Boolean(h.integration.liveTrace)).length;
  const harvestedPaths = useMemo(
    () => payload.harnesses.flatMap((h) => [h.bin, h.detail, h.probe?.version.output, h.probe?.help?.output]),
    [payload.harnesses],
  );
  const { show } = useRedactedShow(harvestedPaths, { secrets: true });

  const activeConnection = active as ConnectionHarness | undefined;

  return (
    <div className="mx-auto min-w-0 max-w-7xl px-4 py-5 sm:p-6 lg:p-8">
      <PageHeader
        icon={Plug}
        title="Harnesses"
        subtitle="Inspect what OpenEval can execute, measure, and collect from every registered agent CLI."
        actions={
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            aria-busy={refreshing}
            className="flex min-h-10 items-center gap-2 rounded-lg border border-bd px-3 text-sm text-fg-muted hover:bg-bg-elev hover:text-fg disabled:opacity-50"
          >
            <RefreshCw aria-hidden="true" className={clsx("size-3.5", refreshing && "animate-spin")} />
            <span className="hidden sm:inline">{refreshing ? "Refreshing…" : "Refresh registry"}</span>
            <span className="sm:hidden">Refresh</span>
          </button>
        }
      />
      <SystemNav />

      <ConnectionCenter
        descriptorText={descriptorText}
        descriptorPreview={descriptorPreview}
        descriptorError={descriptorError}
        managing={managing}
        onTextChange={(text) => { setDescriptorText(text); setDescriptorPreview(null); setDescriptorError(null); }}
        onFile={(file) => { void file.text().then((text) => { setDescriptorText(text); setDescriptorPreview(null); setDescriptorError(null); }); }}
        onTemplate={loadTemplate}
        onPreview={() => void previewDescriptor()}
        onSave={() => void saveDescriptor()}
      />

      <div aria-live="polite" className="sr-only">{notice}</div>
      {error && (
        <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-err/30 bg-err/5 p-3 text-sm text-err">
          <span className="flex min-w-0 items-start gap-2">
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </span>
          <button type="button" onClick={() => void load(false)} className="min-h-10 shrink-0 rounded-lg border border-err/30 px-3 font-medium hover:bg-err/10">
            Retry
          </button>
        </div>
      )}

      <section aria-label="Registry summary" className="mb-5 grid grid-cols-2 overflow-hidden rounded-xl border border-bd bg-bg-subtle lg:grid-cols-4">
        <SummaryMetric icon={CheckCircle2} label="Ready" value={`${payload.availableCount}/${payload.harnesses.length}`} detail="safe probes passed" tone="ok" />
        <SummaryMetric icon={ShieldCheck} label="Default" value={payload.defaultHarness || "—"} detail="used when unspecified" />
        <SummaryMetric icon={Database} label="Transcript sources" value={`${transcriptSources}/${payload.harnesses.length}`} detail="collection contracts" />
        <SummaryMetric
          icon={Gauge}
          label="Descriptor health"
          value={payload.descriptorIssues.length ? `${payload.descriptorIssues.length} issue${payload.descriptorIssues.length === 1 ? "" : "s"}` : "Clean"}
          detail={`${fullTelemetry} report cost + tokens + turns`}
          tone={payload.descriptorIssues.length ? "warn" : "ok"}
        />
      </section>

      {payload.descriptorIssues.length > 0 && (
        <section aria-labelledby="descriptor-issues-title" className="mb-5 rounded-xl border border-warn/30 bg-warn/5 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-warn">
            <AlertCircle aria-hidden="true" className="size-4" />
            <h2 id="descriptor-issues-title">Descriptor issues</h2>
          </div>
          <p className="mt-1 text-xs text-fg-muted">Invalid custom descriptors are excluded from the registry until corrected.</p>
          <ul className="mt-3 space-y-2">
            {payload.descriptorIssues.slice(0, 8).map((issue, index) => (
              <li key={`${issue.source}-${index}`} className="rounded-lg border border-warn/15 bg-bg/50 px-3 py-2 text-xs">
                <span className="mono text-warn">{show(issue.source)}</span>
                <span className="ml-2 text-fg-muted">{issue.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {loading && payload.harnesses.length === 0 ? (
        <HarnessesSkeleton />
      ) : payload.harnesses.length === 0 ? (
        <section className="card grid min-h-72 place-items-center p-6 text-center">
          <div>
            <Terminal aria-hidden="true" className="mx-auto size-8 text-fg-dim" />
            <h2 className="mt-3 text-base font-medium">No harnesses registered</h2>
            <p className="mt-1 max-w-md text-sm text-fg-muted">Add a valid descriptor under <span className="mono">harnesses/</span>, then refresh the registry.</p>
          </div>
        </section>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="card overflow-hidden xl:sticky xl:top-4" aria-label="Registered harnesses">
            <div className="border-b border-bd-subtle p-3">
              <div className="flex min-h-10 items-center gap-2 rounded-lg border border-bd bg-bg px-3">
                <Search aria-hidden="true" className="size-3.5 text-fg-dim" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find a harness…"
                  aria-label="Find a harness"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-dim"
                />
                {query && <span className="mono text-[10px] text-fg-dim">{filtered.length}</span>}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1" aria-label="Harness status filter">
                {([
                  ["all", "All"],
                  ["available", "Ready"],
                  ["attention", "Attention"],
                ] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={filter === id}
                    onClick={() => setFilter(id)}
                    className={clsx(
                      "min-h-10 rounded-lg px-2 text-[11px] font-medium",
                      filter === id ? "bg-accent/10 text-accent-soft" : "text-fg-muted hover:bg-bg-elev hover:text-fg",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div role="tablist" aria-label="Harness details" className="max-h-[520px] space-y-1 overflow-y-auto p-2 scroll-contain">
              {filtered.map((h, index) => {
                const meta = STATUS_META[h.status] ?? STATUS_META.not_found;
                const isSelected = h.id === active?.id;
                return (
                  <button
                    key={h.id}
                    id={`harness-tab-${h.id}`}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    aria-controls={`harness-panel-${h.id}`}
                    tabIndex={isSelected ? 0 : -1}
                    onClick={() => choose(h.id)}
                    onKeyDown={(event) => {
                      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                      event.preventDefault();
                      const nextIndex = event.key === "Home" ? 0
                        : event.key === "End" ? filtered.length - 1
                        : event.key === "ArrowDown" ? (index + 1) % filtered.length
                        : (index - 1 + filtered.length) % filtered.length;
                      const next = filtered[nextIndex];
                      if (next) {
                        choose(next.id);
                        document.getElementById(`harness-tab-${next.id}`)?.focus();
                      }
                    }}
                    className={clsx(
                      "w-full rounded-lg border px-3 py-3 text-left",
                      isSelected ? "border-accent/45 bg-accent/10" : "border-transparent hover:border-bd hover:bg-bg-elev",
                    )}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span aria-hidden="true" className={clsx("size-2 rounded-full", meta.dot)} />
                          <span className="truncate text-sm font-medium">{h.label}</span>
                        </span>
                        <span className="mt-1 block truncate pl-4 text-[10px] text-fg-dim mono">{h.version ?? h.id}</span>
                      </span>
                      {h.id === payload.defaultHarness && (
                        <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-accent-soft">default</span>
                      )}
                    </span>
                    <span className="mt-2 flex items-center justify-between pl-4">
                      <span className={clsx("rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em]", meta.cls)}>{meta.label}</span>
                      <span className="mono text-[9px] text-fg-dim">{h.integration.parser}</span>
                    </span>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <div className="px-3 py-8 text-center text-xs text-fg-muted">No harnesses match this view.</div>
              )}
            </div>
          </aside>

          {active && (
            <HarnessDetail
              harness={active}
              isDefault={active.id === payload.defaultHarness}
              connection={activeConnection}
              probing={probing === active.id}
              show={show}
              onProbe={() => void probe(active.id)}
              onReconnect={() => void reconnect(active.id)}
              onDisconnect={() => void disconnect(active.id)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function HarnessDetail({
  harness,
  isDefault,
  connection,
  probing,
  show,
  onProbe,
  onReconnect,
  onDisconnect,
}: {
  harness: DiscoveredHarness;
  isDefault: boolean;
  connection?: ConnectionHarness;
  probing: boolean;
  show: (value: unknown) => string;
  onProbe: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
}) {
  const meta = STATUS_META[harness.status] ?? STATUS_META.not_found;
  const command = harness.sampleCommand ? commandText(harness.sampleCommand) : "";
  const trace = harness.integration.liveTrace;
  return (
    <section
      id={`harness-panel-${harness.id}`}
      role="tabpanel"
      aria-labelledby={`harness-tab-${harness.id}`}
      className="min-w-0 space-y-4"
    >
      <div className="card overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-bd-subtle p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">{harness.label}</h2>
              <span className={clsx("rounded-lg border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em]", meta.cls)}>{meta.label}</span>
              {isDefault && <span className="rounded-lg border border-accent/25 bg-accent/10 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-accent-soft">Default adapter</span>}
            </div>
            <p className="mt-1 mono text-xs text-fg-dim">{harness.id}</p>
            <p className="mt-2 max-w-2xl text-sm text-fg-muted">
              {harness.status === "available"
                ? "The executable resolved and its non-spending version/help probes passed."
                : harness.detail ?? "This harness needs attention before OpenEval can execute it."}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {harness.status === "available" && (
              <Link href={`/runs/new?harness=${encodeURIComponent(harness.id)}`} className="flex min-h-10 items-center gap-2 rounded-lg bg-accent px-3 text-sm font-medium text-white hover:bg-accent/90">
                New run <ArrowUpRight aria-hidden="true" className="size-3.5" />
              </Link>
            )}
            {connection?.registration?.provenance !== "bundled-reference" && (
              <button
                type="button"
                onClick={onReconnect}
                disabled={probing}
                className="flex min-h-10 items-center gap-2 rounded-lg border border-accent/30 px-3 text-sm text-accent-soft hover:bg-accent/10 disabled:opacity-50"
              >
                <RefreshCw aria-hidden="true" className={clsx("size-3.5", probing && "animate-spin")} /> Reconnect
              </button>
            )}
            {connection?.registration?.provenance !== "bundled-reference" && (
              <button
                type="button"
                onClick={onDisconnect}
                className="flex min-h-10 items-center gap-2 rounded-lg border border-bd px-3 text-sm text-fg-muted hover:border-err/35 hover:bg-err/5 hover:text-err"
              >
                <Trash2 aria-hidden="true" className="size-3.5" /> Disconnect
              </button>
            )}
            <button
              type="button"
              onClick={onProbe}
              disabled={probing}
              aria-busy={probing}
              className="flex min-h-10 items-center gap-2 rounded-lg border border-bd px-3 text-sm text-fg-muted hover:bg-bg-elev hover:text-fg disabled:opacity-50"
            >
              {probing ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : <RefreshCw aria-hidden="true" className="size-3.5" />}
              {probing ? "Probing…" : "Probe now"}
            </button>
          </div>
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label="Executable" value={harness.bin ? show(harness.bin) : "Not resolved"} />
          <Fact label="Version" value={harness.version ?? "Unavailable"} />
          <Fact label="Resolution" value={sourceLabel(harness.source)} />
          <Fact label="Output parser" value={harness.integration.parser} />
        </dl>
      </div>

      <ReadinessPanel harness={connection ?? (harness as ConnectionHarness)} probing={probing} onProbe={onProbe} />

      <section aria-labelledby="capability-title" className="card p-4 sm:p-5">
        <SectionHeading icon={Gauge} id="capability-title" title="Capability evidence" detail="Descriptor declarations, kept separate from runtime probe evidence." />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <CapabilityGroup
            title="Measured telemetry"
            icon={Gauge}
            items={[
              ["USD cost", harness.capabilities.reportsCost],
              ["Token usage", harness.capabilities.reportsTokens],
              ["Turn count", harness.capabilities.reportsTurns],
            ]}
          />
          <CapabilityGroup
            title="Visual input"
            icon={Eye}
            items={[
              ["Vision declared", harness.capabilities.supportsVisionInput],
              ["Attachment flag declared", Boolean(harness.imageFlag)],
              ["Flag observed in help", harness.probe?.imageFlagObserved ?? null],
            ]}
          />
          <div className="rounded-xl border border-bd-subtle bg-bg/40 p-4">
            <div className="flex items-center gap-2 text-xs font-medium"><ShieldCheck aria-hidden="true" className="size-4 text-accent-soft" /> Run controls</div>
            <dl className="mt-3 space-y-2 text-xs">
              <MiniFact label="Prompt transport" value={harness.integration.promptMode} />
              <MiniFact label="Default model" value={harness.integration.modelDefault ?? harness.sampleCommand?.model ?? "harness auto"} />
              <MiniFact label="Known model aliases" value={String(harness.integration.modelAliasCount)} />
              <MiniFact label="Local model discovery" value={harness.integration.modelDiscovery ? "configured" : "not configured"} />
            </dl>
          </div>
          <div className="rounded-xl border border-bd-subtle bg-bg/40 p-4">
            <div className="flex items-center gap-2 text-xs font-medium"><Database aria-hidden="true" className="size-4 text-accent-soft" /> Transcript collection</div>
            <dl className="mt-3 space-y-2 text-xs">
              <MiniFact label="Trace contract" value={trace ? trace.format : "not declared"} />
              <MiniFact label="Roots" value={trace ? String(trace.roots.length) : "0"} />
              <MiniFact label="Scan depth" value={trace?.maxDepth == null ? "descriptor default" : String(trace.maxDepth)} />
              <MiniFact label="Missing model fallback" value={trace?.inferredModel ?? "none"} />
            </dl>
          </div>
        </div>
      </section>

      <section aria-labelledby="collection-title" className="card p-4 sm:p-5">
        <SectionHeading icon={Database} id="collection-title" title="Collection contract" detail="Where archived parent and nested agent traces are eligible for discovery." />
        {trace ? (
          <>
            <div className="mt-4 grid gap-2">
              {trace.roots.map((root) => (
                <div key={root} className="flex min-w-0 items-center gap-2 rounded-lg border border-bd-subtle bg-bg px-3 py-2.5">
                  <Terminal aria-hidden="true" className="size-3.5 shrink-0 text-fg-dim" />
                  <code className="min-w-0 flex-1 truncate text-xs">{show(root)}</code>
                  <CopyButton text={root} label={`Copy trace root ${root}`} className="min-h-9 min-w-9" />
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs leading-5 text-fg-muted">
              Format <span className="mono text-fg">{trace.format}</span>
              {trace.maxDepth != null ? <> is scanned to a declared depth of <span className="mono text-fg">{trace.maxDepth}</span></> : null}.
              Nested subagent files remain distinct sessions when the parser can identify their lineage; this card describes eligibility, not a claim that every file parsed successfully.
            </p>
          </>
        ) : (
          <div className="mt-4 rounded-lg border border-warn/20 bg-warn/5 p-3 text-sm text-fg-muted">
            This descriptor does not declare a live transcript source. OpenEval can run it, but Collection cannot discover its archived sessions through this adapter.
          </div>
        )}
      </section>

      <section aria-labelledby="command-title" className="card overflow-hidden">
        <div className="flex items-start justify-between gap-3 p-4 sm:p-5">
          <SectionHeading icon={Terminal} id="command-title" title="Execution preview" detail="Descriptor-built example only; this does not run a model." />
          {command && <CopyButton text={command} label="Copy sample command" className="min-h-10 min-w-10 rounded-lg border border-bd" />}
        </div>
        <pre className="max-h-52 overflow-auto border-y border-bd-subtle bg-bg p-4 text-[11px] leading-5 text-fg-muted scroll-contain"><code>{command ? show(command) : "No sample command available."}</code></pre>
        <div className="grid gap-3 p-4 text-xs sm:grid-cols-2 sm:p-5">
          <MiniFact label="Binary candidates" value={harness.binNames.join(", ")} />
          <MiniFact label="Permission modes" value={harness.capabilities.permissionModes.length ? harness.capabilities.permissionModes.join(", ") : "none declared"} />
        </div>
      </section>

      <section aria-labelledby="probe-title" className="card p-4 sm:p-5">
        <SectionHeading icon={Braces} id="probe-title" title="Probe evidence" detail="Safe CLI metadata checks; no prompt or inference request is sent." />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <ProbeCheckCard label="Version check" check={harness.probe?.version} show={show} />
          <ProbeCheckCard label="Help check" check={harness.probe?.help} show={show} />
        </div>
      </section>
    </section>
  );
}

function ConnectionCenter({
  descriptorText,
  descriptorPreview,
  descriptorError,
  managing,
  onTextChange,
  onFile,
  onTemplate,
  onPreview,
  onSave,
}: {
  descriptorText: string;
  descriptorPreview: NormalizedPreview | null;
  descriptorError: string | null;
  managing: "preview" | "save" | "disconnect" | null;
  onTextChange: (value: string) => void;
  onFile: (file: File) => void;
  onTemplate: () => void;
  onPreview: () => void;
  onSave: () => void;
}) {
  return (
    <section className="card mb-5 overflow-hidden" aria-labelledby="connection-center-title">
      <div className="border-b border-bd-subtle bg-gradient-to-r from-accent/10 via-transparent to-transparent p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="connection-center-title" className="flex items-center gap-2 text-base font-semibold">
              <FileJson aria-hidden="true" className="size-4 text-accent-soft" /> Connection Center
            </h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-fg-muted">
              Import or paste one complete <span className="mono text-fg">.harness.json</span> descriptor. OpenEval validates it, previews the normalized execution and observation contract, then saves it atomically as a user-managed local connection.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-bd px-3 text-xs text-fg-muted hover:bg-bg-elev hover:text-fg">
              <Upload aria-hidden="true" className="size-3.5" /> Import JSON
              <input
                type="file"
                accept=".json,.harness.json,application/json"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onFile(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <button type="button" onClick={onTemplate} className="min-h-10 rounded-lg border border-bd px-3 text-xs text-fg-muted hover:bg-bg-elev hover:text-fg">Load template</button>
          </div>
        </div>
      </div>
      <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,.9fr)]">
        <div className="min-w-0">
          <label htmlFor="descriptor-json" className="text-xs font-medium text-fg">Descriptor JSON</label>
          <textarea
            id="descriptor-json"
            value={descriptorText}
            onChange={(event) => onTextChange(event.target.value)}
            spellCheck={false}
            placeholder={'{\n  "id": "my-harness",\n  "label": "My Harness",\n  "binNames": ["my-harness"],\n  "parser": "text",\n  "argTemplate": ["{prompt}"]\n}'}
            className="mt-2 min-h-48 w-full resize-y rounded-lg border border-bd bg-bg px-3 py-2 font-mono text-[11px] leading-5 text-fg-muted outline-none placeholder:text-fg-dim focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={onPreview} disabled={!descriptorText.trim() || managing !== null} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 text-xs font-medium text-accent-soft hover:bg-accent/15 disabled:opacity-50">
              {managing === "preview" ? <Loader2 className="size-3.5 animate-spin" /> : <Braces className="size-3.5" />} Validate descriptor
            </button>
            <button type="button" onClick={onSave} disabled={!descriptorPreview || managing !== null} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent px-3 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50">
              {managing === "save" ? <Loader2 className="size-3.5 animate-spin" /> : <Plug className="size-3.5" />} Connect and save
            </button>
          </div>
          {descriptorError && <div role="alert" className="mt-3 rounded-lg border border-err/30 bg-err/5 p-3 text-xs leading-5 text-err">{descriptorError}</div>}
        </div>
        <div className="min-w-0 rounded-xl border border-bd-subtle bg-bg/40 p-4" aria-live="polite">
          <h3 className="flex items-center gap-2 text-xs font-semibold"><ShieldCheck className="size-4 text-accent-soft" /> Normalized contract preview</h3>
          {!descriptorPreview ? (
            <p className="mt-3 text-xs leading-5 text-fg-dim">Validate a complete descriptor to inspect its execution, parser, model, and observation declarations before saving.</p>
          ) : (
            <div className="mt-3 space-y-2 text-xs">
              <PreviewFact label="Identity" value={`${descriptorPreview.descriptor.label} · ${descriptorPreview.descriptor.id}`} />
              <PreviewFact label="Execution" value={`${descriptorPreview.descriptor.binNames.join(", ")} · ${descriptorPreview.descriptor.prompt.mode} prompt`} />
              <PreviewFact label="Parser" value={descriptorPreview.descriptor.parser} />
              <PreviewFact label="Observation" value={descriptorPreview.descriptor.liveTrace ? `${descriptorPreview.descriptor.liveTrace.format} · ${descriptorPreview.descriptor.liveTrace.roots.length} root${descriptorPreview.descriptor.liveTrace.roots.length === 1 ? "" : "s"}` : "No liveTrace declared"} />
              <PreviewFact label="Judge inputs" value={`${descriptorPreview.descriptor.models?.aliases?.length ?? 0} model aliases · ${descriptorPreview.descriptor.capabilities.reportsTokens ? "token telemetry" : "token telemetry unknown"}`} />
              <p className="border-t border-bd-subtle pt-3 text-[11px] leading-5 text-fg-dim">A declaration is not runtime proof. After saving, use safe probes and the separate readiness layers below.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function PreviewFact({ label, value }: { label: string; value: string }) {
  return <div className="flex min-w-0 items-start justify-between gap-3"><span className="shrink-0 text-fg-dim">{label}</span><span className="min-w-0 break-words text-right text-fg-muted mono">{value}</span></div>;
}

function ReadinessPanel({ harness, probing, onProbe }: { harness: ConnectionHarness; probing: boolean; onProbe: () => void }) {
  const layers = harness.readiness ?? [];
  return (
    <section aria-labelledby="readiness-title" className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="readiness-title" className="flex items-center gap-2 text-sm font-semibold"><Gauge className="size-4 text-accent-soft" /> Layered readiness</h2>
          <p className="mt-1 max-w-3xl text-[11px] leading-5 text-fg-dim">These are independent evidence layers. A safe binary probe never claims provider authentication, parse coverage, or a completed judge verdict.</p>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-fg-dim">
          <span className="mono">{registrationLabel(harness.registration?.provenance)}</span>
          {harness.registration?.revision && <span title={harness.registration.revision}>rev {harness.registration.revision.slice(0, 8)}</span>}
        </div>
      </div>
      {layers.length === 0 ? (
        <div className="mt-4 rounded-lg border border-warn/25 bg-warn/5 p-3 text-xs text-warn">Readiness is unavailable while the registry response is being refreshed.</div>
      ) : (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {layers.map((layer) => <ReadinessCard key={layer.id} layer={layer} probing={probing && layer.id === "binary"} onProbe={onProbe} />)}
        </div>
      )}
    </section>
  );
}

function ReadinessCard({ layer, probing, onProbe }: { layer: ReadinessLayer; probing: boolean; onProbe: () => void }) {
  const meta = readinessMeta(layer.state);
  return (
    <div className={clsx("min-w-0 rounded-xl border p-3", meta.border, meta.bg)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-dim">{layer.label}</span>
        <span className={clsx("inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[9px] font-medium uppercase tracking-[0.12em]", meta.badge)}><span className={clsx("size-1.5 rounded-full", meta.dot)} />{layer.state}</span>
      </div>
      <p className="mt-2 text-xs font-medium leading-4">{layer.summary}</p>
      <p className="mt-1 text-[10px] leading-4 text-fg-muted">{layer.diagnostic}</p>
      <button type="button" onClick={layer.id === "binary" ? onProbe : undefined} disabled={layer.id !== "binary" || probing} className={clsx("mt-3 min-h-9 rounded-md border px-2.5 text-[10px] font-medium", layer.id === "binary" ? "border-bd text-fg-muted hover:bg-bg-elev hover:text-fg" : "cursor-default border-transparent px-0 text-fg-dim")}>{probing ? "Probing…" : layer.action}</button>
    </div>
  );
}

function readinessMeta(state: ReadinessLayer["state"]): { border: string; bg: string; badge: string; dot: string } {
  if (state === "ready") return { border: "border-ok/25", bg: "bg-ok/5", badge: "border-ok/30 bg-ok/10 text-ok", dot: "bg-ok" };
  if (state === "partial") return { border: "border-warn/30", bg: "bg-warn/5", badge: "border-warn/30 bg-warn/10 text-warn", dot: "bg-warn" };
  if (state === "unavailable") return { border: "border-err/25", bg: "bg-err/5", badge: "border-err/30 bg-err/10 text-err", dot: "bg-err" };
  return { border: "border-bd", bg: "bg-bg/40", badge: "border-bd bg-bg-elev text-fg-dim", dot: "bg-fg-dim" };
}

function registrationLabel(provenance?: "user-managed" | "user-override" | "bundled-reference"): string {
  if (provenance === "user-managed") return "user-managed";
  if (provenance === "user-override") return "user override of bundled";
  return "bundled reference";
}

function SummaryMetric({ icon: Icon, label, value, detail, tone }: { icon: typeof Gauge; label: string; value: string; detail: string; tone?: "ok" | "warn" }) {
  return (
    <div className="min-w-0 border-b border-r border-bd-subtle p-3.5 last:border-r-0 lg:border-b-0">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-fg-dim">
        <Icon aria-hidden="true" className={clsx("size-3.5", tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-accent-soft")} />
        {label}
      </div>
      <div className={clsx("mt-1 truncate text-lg font-semibold mono", tone === "warn" && "text-warn")}>{value}</div>
      <div className="mt-0.5 truncate text-[10px] text-fg-dim">{detail}</div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-b border-r border-bd-subtle p-4 last:border-r-0 xl:border-b-0">
      <dt className="text-[10px] font-medium uppercase tracking-[0.12em] text-fg-dim">{label}</dt>
      <dd className="mt-1 truncate text-xs mono" title={value}>{value}</dd>
    </div>
  );
}

function SectionHeading({ icon: Icon, id, title, detail }: { icon: typeof Gauge; id: string; title: string; detail: string }) {
  return (
    <div>
      <h2 id={id} className="flex items-center gap-2 text-sm font-semibold">
        <span className="grid size-7 place-items-center rounded-lg bg-accent/10"><Icon aria-hidden="true" className="size-3.5 text-accent-soft" /></span>
        {title}
      </h2>
      <p className="mt-1 text-[11px] text-fg-dim">{detail}</p>
    </div>
  );
}

function CapabilityGroup({ title, icon: Icon, items }: { title: string; icon: typeof Gauge; items: Array<[string, boolean | null]> }) {
  return (
    <div className="rounded-xl border border-bd-subtle bg-bg/40 p-4">
      <div className="flex items-center gap-2 text-xs font-medium"><Icon aria-hidden="true" className="size-4 text-accent-soft" /> {title}</div>
      <div className="mt-3 grid grid-cols-1 gap-2 min-[440px]:grid-cols-3">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-bd-subtle bg-bg px-2.5 py-2">
            <div className={clsx("flex items-center gap-1.5 text-xs font-medium", value === true ? "text-ok" : value === false ? "text-fg-muted" : "text-warn")}>
              {value === true ? <CheckCircle2 aria-hidden="true" className="size-3.5" /> : value === false ? <XCircle aria-hidden="true" className="size-3.5" /> : <AlertCircle aria-hidden="true" className="size-3.5" />}
              {value === true ? "Yes" : value === false ? "No" : "Unknown"}
            </div>
            <div className="mt-1 text-[9px] leading-3 text-fg-dim">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <dt className="shrink-0 text-fg-dim">{label}</dt>
      <dd className="min-w-0 break-words text-right mono text-fg-muted">{value}</dd>
    </div>
  );
}

function ProbeCheckCard({ label, check, show }: { label: string; check?: { ok: boolean; args: string[]; output?: string; error?: string }; show: (value: unknown) => string }) {
  if (!check) {
    return <div className="rounded-xl border border-bd-subtle bg-bg/40 p-4 text-xs text-fg-dim">{label}: not configured</div>;
  }
  const evidence = check.output || check.error || "No output";
  return (
    <details className="group rounded-xl border border-bd-subtle bg-bg/40 p-4">
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3">
        <span>
          <span className="flex items-center gap-2 text-xs font-medium">
            {check.ok ? <CheckCircle2 aria-hidden="true" className="size-4 text-ok" /> : <AlertCircle aria-hidden="true" className="size-4 text-err" />}
            {label}
          </span>
          <span className="mt-1 block mono text-[10px] text-fg-dim">{check.args.join(" ") || "(no arguments)"}</span>
        </span>
        <span className={clsx("rounded border px-2 py-1 text-[9px] font-medium uppercase tracking-[0.12em]", check.ok ? "border-ok/25 bg-ok/10 text-ok" : "border-err/25 bg-err/10 text-err")}>{check.ok ? "Passed" : "Failed"}</span>
      </summary>
      <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-bd-subtle bg-bg p-3 text-[10px] leading-4 text-fg-muted scroll-contain"><code>{show(evidence)}</code></pre>
    </details>
  );
}

function HarnessesSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading harness registry" className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className="card space-y-2 p-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 rounded-lg shimmer" />)}</div>
      <div className="card space-y-4 p-5"><div className="h-7 w-52 rounded shimmer" /><div className="h-16 rounded shimmer" /><div className="grid gap-3 sm:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 rounded-xl shimmer" />)}</div></div>
    </div>
  );
}

function readHarnessParam(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("harness");
  } catch {
    return null;
  }
}

function sourceLabel(source: DiscoveredHarness["source"]): string {
  return source === "env" ? "environment override"
    : source === "path" ? "PATH"
    : source === "well_known" ? "well-known path"
    : source === "default" ? "default binary"
    : "unresolved";
}

function commandText(command: NonNullable<DiscoveredHarness["sampleCommand"]>): string {
  const env = Object.entries(command.env ?? {}).map(([key, value]) => `${key}=${shellQuote(value)}`);
  const base = [command.bin, ...command.args].map(shellQuote);
  const invocation = [...env, ...base].join(" ");
  return command.stdin == null ? invocation : `printf %s ${shellQuote(command.stdin)} | ${invocation}`;
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}
