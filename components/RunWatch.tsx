"use client";

import Link from "next/link";
import clsx from "clsx";
import { useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Eye,
  Gauge,
  Loader2,
  PauseCircle,
  Radio,
  RefreshCw,
  Sparkles,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import type { RunCaseRecord } from "@/lib/types";
import type { RunEvent, RunEventsStatus } from "@/lib/use-run-events";

interface Props {
  runId: string;
  createdAt?: number;
  endedAt?: number | null;
  cases: RunCaseRecord[];
  live: boolean;
  streamStatus: RunEventsStatus;
  events: RunEvent[];
  selectedIdx: number | null;
  onSelect: (index: number) => void;
}

const TERMINAL_STATUSES = new Set(["passed", "failed", "error", "skipped"]);
type ActivityFilter = "all" | "tools" | "results";

/** A calm live surface: current case, phase, progress pulse, and recent events. */
export default function RunWatch({ runId, createdAt, endedAt, cases, live, streamStatus, events, selectedIdx, onSelect }: Props) {
  const [now, setNow] = useState<number | null>(null);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  useEffect(() => {
    if (!live) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [live]);
  const completed = cases.filter((c) => TERMINAL_STATUSES.has(c.status)).length;
  const activeIndex = cases.findIndex((c) => c.status === "running" || c.status === "grading");
  const activeCount = cases.filter((c) => c.status === "running" || c.status === "grading").length;
  const nextIndex = activeIndex >= 0 ? activeIndex : cases.findIndex((c) => c.status === "pending");
  const focusIndex = nextIndex >= 0 ? nextIndex : selectedIdx ?? (cases.length ? 0 : -1);
  const focusCase = focusIndex >= 0 ? cases[focusIndex] : null;
  const focusEvent = focusCase ? findLatestCaseEvent(events, focusCase) : null;
  const phase = focusCase ? phaseFor(focusCase, focusEvent) : completed === cases.length && cases.length > 0 ? "complete" : "waiting";
  const passed = cases.filter((c) => c.status === "passed").length;
  const failed = cases.filter((c) => c.status === "failed").length;
  const errors = cases.filter((c) => c.status === "error").length;
  const visualCount = cases.filter((c) => c.case_def?.visual?.expected_artifacts?.length).length;
  const observedStart = cases.reduce<number | null>((min, c) => c.started_at == null ? min : min == null ? c.started_at : Math.min(min, c.started_at), null);
  const observedEnd = cases.reduce<number | null>((max, c) => c.ended_at == null ? max : max == null ? c.ended_at : Math.max(max, c.ended_at), null);
  const start = createdAt ?? observedStart;
  const end = live ? now : endedAt ?? observedEnd;
  const wallTime = start != null && end != null ? Math.max(0, end - start) : 0;
  const recentEvents = [...events].reverse().filter((event) => matchesActivityFilter(event, activityFilter)).slice(0, 6);
  const resolution = cases.length ? Math.round((completed / cases.length) * 100) : null;
  const passRate = cases.length ? Math.round((passed / cases.length) * 100) : null;
  const statusAnnouncement = watchStatusAnnouncement({
    live,
    streamStatus,
    cases: cases.length,
    completed,
    focusCaseName: focusCase?.case_name ?? null,
    phase,
    focusEvent,
  });

  return (
    <section className="card mb-4 overflow-hidden" aria-labelledby="run-watch-title" data-testid="run-watch-mode">
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="run-watch-announcement">
        {statusAnnouncement}
      </div>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-bd-subtle bg-bg-subtle/55 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={clsx("grid size-8 shrink-0 place-items-center rounded-lg", live ? "bg-accent/15 text-accent-soft" : "bg-bg-elev text-fg-muted")}>
            {live ? <Radio aria-hidden="true" className="size-4 animate-pulse" /> : <Activity aria-hidden="true" className="size-4" />}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 id="run-watch-title" className="text-sm font-semibold">Watch mode</h2>
              <StreamBadge live={live} status={streamStatus} />
            </div>
            <p className="mt-0.5 text-[11px] text-fg-dim">One calm view of what is running, what changed, and where to inspect next.</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px] mono text-fg-muted tabular-nums">
          <span>{cases.length ? `${completed}/${cases.length} resolved` : "No cases yet"}</span>
          <span className="text-fg-dim">{resolution == null ? "—" : `${resolution}%`}</span>
        </div>
      </header>

      <div className="grid gap-3 p-3 sm:p-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(210px,0.7fr)_minmax(240px,0.9fr)]">
        <section className="rounded-xl border border-accent/20 bg-accent/5 p-4" aria-labelledby="run-watch-current-title" data-testid="run-watch-current">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[10px] uppercase tracking-[0.16em] text-accent-soft">{activeIndex >= 0 ? `Now running${activeCount > 1 ? ` · ${activeCount} active` : ""}` : nextIndex >= 0 ? "Up next" : live ? "Waiting for cases" : "Run settled"}</div>
            {focusCase && <PhaseBadge phase={phase} />}
          </div>
          {focusCase ? (
            <>
              <div className="mt-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 id="run-watch-current-title" className="text-base font-semibold leading-6 text-fg">{focusCase.case_name}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-fg-dim mono">
                    <span>{focusCase.case_id}</span><span aria-hidden="true">·</span><span>{focusCase.category}</span>
                    {focusCase.case_def?.visual?.kind && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent-soft">{visualKindLabel(focusCase.case_def.visual.kind)}</span>}
                  </div>
                </div>
                <span className="shrink-0 text-right text-[10px] text-fg-dim mono tabular-nums">case {String(focusIndex + 1).padStart(2, "0")} / {String(cases.length).padStart(2, "0")}</span>
              </div>
              <div className="mt-4 flex items-center gap-2" role="list" aria-label="Case lifecycle">
                {[["queued", "Queued"], ["generating", "Generating"], ["grading", "Grading"], ["complete", "Result"]].map(([key, label], index) => {
                  const current = phaseIndex(phase) >= index;
                  const currentStep = phaseIndex(phase) === index;
                  const stepState = currentStep ? "current" : current ? "complete" : "pending";
                  return (
                    <div key={key} role="listitem" aria-current={currentStep ? "step" : undefined} aria-label={`${label}: ${stepState}`} className="flex min-w-0 flex-1 items-center gap-2">
                      <span className={clsx("grid size-5 shrink-0 place-items-center rounded-full border text-[9px]", current ? "border-accent-soft/50 bg-accent/20 text-accent-soft" : "border-bd-subtle bg-bg/40 text-fg-dim")}>
                        {current && (phaseIndex(phase) > index || isTerminalPhase(phase)) ? <Check aria-hidden="true" className="size-3" /> : index + 1}
                      </span>
                      <span className={clsx("block max-w-[6.5rem] truncate text-[10px]", current ? "text-fg-muted" : "text-fg-dim")}>{label}</span>
                      {index < 3 && <span className={clsx("h-px min-w-2 flex-1", phaseIndex(phase) > index ? "bg-accent/50" : "bg-bd-subtle")} />}
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-muted"><span className={clsx("size-1.5 rounded-full", live && activeIndex >= 0 ? "bg-accent-soft animate-pulse" : "bg-fg-dim")} />{phaseCopy(phase, focusEvent)}</span>
                <button type="button" onClick={() => onSelect(focusIndex)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-accent/15 px-3 text-[11px] font-medium text-accent-soft transition-colors hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Open evidence <ArrowRight aria-hidden="true" className="size-3.5" /></button>
              </div>
            </>
          ) : <div className="mt-4 flex items-center gap-3 text-sm text-fg-muted"><CircleDashed className="size-5 text-fg-dim" />No cases have entered the run yet.</div>}
        </section>

        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2" aria-label="Live run pulse">
          <PulseStat icon={Clock3} label="Wall time" value={formatDuration(wallTime)} />
          <PulseStat icon={CheckCircle2} label="Pass rate" value={passRate == null ? "—" : `${passRate}%`} tone={failed || errors ? "warn" : "ok"} />
          <PulseStat icon={Gauge} label="Resolved" value={`${completed}/${cases.length || 0}`} />
          <PulseStat icon={Eye} label="Visual lanes" value={String(visualCount)} />
          <div className="col-span-2 rounded-xl border border-bd-subtle bg-bg/45 p-3 sm:col-span-4 xl:col-span-2">
            <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.13em] text-fg-muted"><span>Resolution</span><span className="mono text-fg-dim tabular-nums">{resolution == null ? "—" : `${resolution}%`}</span></div>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-bg-elev"
              role="progressbar"
              aria-label="Run resolution"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={resolution ?? undefined}
              aria-valuetext={resolution == null ? "No cases yet" : `${resolution}% resolved`}
            >
              <div className="h-full rounded-full bg-accent-soft transition-[width] duration-500" style={{ width: `${resolution ?? 0}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-fg-dim"><span className="text-ok">{passed} passed</span><span className="text-err">{failed} failed</span><span className="text-warn">{errors} errors</span><span>{cases.filter((c) => c.status === "skipped").length} skipped</span></div>
          </div>
          {visualCount > 0 && <p className="col-span-2 text-[10px] leading-4 text-fg-dim sm:col-span-4 xl:col-span-2">Visual lanes count declared artifact contracts only; artifact presence is not a visual-quality verdict.</p>}
        </section>

        <section className="rounded-xl border border-bd-subtle bg-bg/45" aria-labelledby="run-watch-activity-title">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-bd-subtle px-3 py-2.5"><div className="flex items-center gap-1.5"><Sparkles aria-hidden="true" className="size-3.5 text-accent-soft" /><h3 id="run-watch-activity-title" className="text-[11px] font-medium">Recent activity</h3></div><span className="text-[10px] text-fg-dim mono">{events.length ? `${events.length > 6 ? `Showing latest 6 of ${events.length}` : `${events.length}`} event${events.length === 1 ? "" : "s"} · latest ${formatAge((now ?? Date.now()) - events[events.length - 1].at)}` : "quiet"}</span></div>
          <div className="flex items-center gap-1 border-b border-bd-subtle px-3 py-2" role="group" aria-label="Activity filter">
            {([["all", "All"], ["tools", "Tools"], ["results", "Results"]] as Array<[ActivityFilter, string]>).map(([value, label]) => <button key={value} type="button" aria-pressed={activityFilter === value} onClick={() => setActivityFilter(value)} className={clsx("min-h-7 rounded-md px-2 text-[10px] transition-colors", activityFilter === value ? "bg-accent/15 text-accent-soft" : "text-fg-dim hover:bg-bg-elev hover:text-fg")}>{label}</button>)}
          </div>
          <div className="max-h-[220px] overflow-y-auto p-2" role="log" aria-live="polite" aria-relevant="additions">
            {recentEvents.length ? recentEvents.map((event) => <ActivityRow key={`${event.id}-${event.kind}`} event={event} cases={cases} onSelect={onSelect} />) : <div className="flex min-h-[160px] flex-col items-center justify-center px-4 text-center"><Terminal aria-hidden="true" className="size-5 text-fg-dim" /><p className="mt-2 text-[11px] text-fg-muted">{live ? "Waiting for the next run event…" : events.length ? "No events match this filter." : "The run is settled. Select a case below to inspect its evidence."}</p>{focusCase && !events.length && <Link href={`/runs/${runId}/case/${focusCase.case_id}`} className="mt-2 text-[10px] text-accent-soft hover:underline">Open full case transcript</Link>}</div>}
          </div>
        </section>
      </div>
    </section>
  );
}

function PulseStat({ icon: Icon, label, value, tone }: { icon: typeof Clock3; label: string; value: string; tone?: "ok" | "warn" }) {
  return <div className="rounded-xl border border-bd-subtle bg-bg/45 p-3"><div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-fg-muted"><Icon aria-hidden="true" className="size-3" />{label}</div><div className={clsx("mt-1.5 text-base font-semibold mono tabular-nums", tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-fg")}>{value}</div></div>;
}

function StreamBadge({ live, status }: { live: boolean; status: RunEventsStatus }) {
  const reconnecting = status === "reconnecting" || status === "connecting";
  const paused = status === "paused";
  const closed = status === "closed";
  const label = !live ? "settled" : closed ? "closed" : paused ? "paused" : reconnecting ? "reconnecting" : status === "open" ? "live stream" : "starting";
  const Icon = !live || closed ? CheckCircle2 : paused ? PauseCircle : reconnecting ? RefreshCw : Radio;
  return <span className={clsx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] mono", !live || closed ? "border-ok/25 bg-ok/10 text-ok" : paused || reconnecting ? "border-warn/25 bg-warn/10 text-warn" : "border-accent-soft/25 bg-accent/10 text-accent-soft")}><Icon aria-hidden="true" className={clsx("size-3", reconnecting && "animate-spin")} />{label}</span>;
}

function PhaseBadge({ phase }: { phase: string }) {
  const terminal = isTerminalPhase(phase);
  const failure = phase === "failed" || phase === "error";
  return <span className={clsx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]", failure ? "border-err/25 bg-err/10 text-err" : phase === "skipped" ? "border-warn/25 bg-warn/10 text-warn" : "border-accent-soft/25 bg-accent/10 text-accent-soft")}><Loader2 aria-hidden="true" className={clsx("size-3", !terminal && (phase === "generating" || phase === "grading") && "animate-spin")} />{phaseLabel(phase)}</span>;
}

function ActivityRow({ event, cases, onSelect }: { event: RunEvent; cases: RunCaseRecord[]; onSelect: (index: number) => void }) {
  const name = eventCaseName(event, cases);
  const caseIndex = cases.findIndex((c) => c.case_id === (event.case_id ?? event.data?.case_id));
  const { label, Icon, tone } = eventPresentation(event, name);
  const content = <><span className={clsx("mt-0.5 grid size-5 shrink-0 place-items-center rounded-md", tone.bg, tone.text)}><Icon aria-hidden="true" className="size-3" /></span><span className="min-w-0 text-left"><span className="block truncate text-[11px] text-fg-muted">{label}</span><span className="mt-0.5 block text-[9px] text-fg-dim mono tabular-nums">{formatEventTime(event.at)}{event.data?.tool ? ` · ${String(event.data.tool)}` : ""}</span></span></>;
  return caseIndex >= 0 ? <button type="button" aria-label={`Open ${name} from activity`} onClick={() => onSelect(caseIndex)} className="flex w-full items-start gap-2 rounded-lg px-2 py-2 hover:bg-bg-elev focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{content}</button> : <div className="flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-bg-elev">{content}</div>;
}

function eventPresentation(event: RunEvent, name: string) {
  const good = { bg: "bg-ok/10", text: "text-ok" };
  const bad = { bg: "bg-err/10", text: "text-err" };
  const neutral = { bg: "bg-accent/10", text: "text-accent-soft" };
  const quiet = { bg: "bg-bg-elev", text: "text-fg-muted" };
  switch (event.kind) {
    case "case_started": return { label: `Started ${name}`, Icon: Radio, tone: neutral };
    case "case_grading": return { label: `Grading ${name}`, Icon: Eye, tone: neutral };
    case "grader_result": return { label: `${event.data?.passed ? "Passed" : "Flagged"} evidence for ${name}`, Icon: event.data?.passed ? CheckCircle2 : X, tone: event.data?.passed ? good : bad };
    case "case_finished": return { label: `${String(event.data?.status ?? "finished")} · ${name}`, Icon: event.data?.status === "passed" ? CheckCircle2 : event.data?.status === "failed" ? X : Activity, tone: event.data?.status === "passed" ? good : event.data?.status === "failed" ? bad : quiet };
    case "case_error": return { label: `Error in ${name}`, Icon: X, tone: bad };
    case "tool_use": return { label: `Tool call in ${name}`, Icon: Wrench, tone: quiet };
    case "tool_result": return { label: `Tool result in ${name}`, Icon: event.data?.error ? X : Check, tone: event.data?.error ? bad : quiet };
    case "assistant_message": return { label: `Assistant response in ${name}`, Icon: Sparkles, tone: quiet };
    case "run_completed": return { label: "Run completed", Icon: CheckCircle2, tone: good };
    case "run_fatal": return { label: "Run stopped by an error", Icon: X, tone: bad };
    case "run_aborted": return { label: "Run cancelled", Icon: PauseCircle, tone: quiet };
    default: return { label: "Run heartbeat", Icon: Activity, tone: quiet };
  }
}

function findLatestCaseEvent(events: RunEvent[], c: RunCaseRecord) { return [...events].reverse().find((event) => event.case_id === c.case_id || event.data?.case_id === c.case_id) ?? null; }
function eventCaseName(event: RunEvent, cases: RunCaseRecord[]) { const id = event.case_id ?? event.data?.case_id; return cases.find((c) => c.case_id === id)?.case_name ?? (id ? String(id) : "run"); }
function phaseFor(c: RunCaseRecord, event: RunEvent | null) { if (c.status === "passed") return "complete"; if (c.status === "failed") return "failed"; if (c.status === "error") return "error"; if (c.status === "skipped") return "skipped"; if (c.status === "grading" || event?.kind === "case_grading" || event?.kind === "grader_result") return "grading"; if (c.status === "running" || event?.kind === "tool_use" || event?.kind === "assistant_message") return "generating"; return "queued"; }
function watchStatusAnnouncement({ live, streamStatus, cases, completed, focusCaseName, phase, focusEvent }: { live: boolean; streamStatus: RunEventsStatus; cases: number; completed: number; focusCaseName: string | null; phase: string; focusEvent: RunEvent | null }) {
  const resolution = cases > 0 ? `${completed} of ${cases} cases resolved` : "No cases yet";
  const stream = streamStatus === "open" ? "live" : streamStatus === "reconnecting" || streamStatus === "connecting" ? "reconnecting" : streamStatus === "paused" ? "paused while the tab is hidden" : streamStatus === "closed" ? "closed" : streamStatus === "idle" ? "inactive" : "starting";
  if (!live) return `Run settled. ${resolution}. Event stream ${stream}.`;
  const focus = focusCaseName ? `${focusCaseName}: ${phaseCopy(phase, focusEvent)}.` : "Waiting for the first case.";
  return `${focus} ${resolution}. Event stream ${stream}.`;
}
function phaseIndex(phase: string) { return phase === "waiting" ? -1 : phase === "queued" ? 0 : phase === "generating" ? 1 : phase === "grading" ? 2 : 3; }
function isTerminalPhase(phase: string) { return phase === "complete" || phase === "failed" || phase === "error" || phase === "skipped"; }
function phaseLabel(phase: string) { return phase === "generating" ? "generating" : phase === "grading" ? "grading" : phase === "complete" ? "complete" : phase === "failed" ? "failed" : phase === "error" ? "error" : phase === "skipped" ? "skipped" : phase === "queued" ? "queued" : "waiting"; }
function phaseCopy(phase: string, event: RunEvent | null) { if (event?.kind === "tool_use") return "Using a tool"; if (event?.kind === "tool_result") return event.data?.error ? "Tool returned an error" : "Tool result received"; if (phase === "grading") return "Checking evidence"; if (phase === "generating") return "Generating response"; if (phase === "complete") return "Evidence is ready to inspect"; if (phase === "failed") return "Evidence failed"; if (phase === "error") return "Runtime error needs review"; if (phase === "skipped") return "Skipped — no evidence generated"; return "Queued for execution"; }
function matchesActivityFilter(event: RunEvent, filter: ActivityFilter) { if (filter === "tools") return event.kind === "tool_use" || event.kind === "tool_result"; if (filter === "results") return event.kind === "grader_result" || event.kind === "case_finished" || event.kind === "case_error" || event.kind === "run_completed" || event.kind === "run_fatal" || event.kind === "run_aborted"; return true; }
function visualKindLabel(kind: string) {
  if (kind === "threejs") return "3D";
  if (kind === "web_ui") return "Web UI";
  if (kind === "app_ui") return "App UI";
  if (kind === "canvas") return "Canvas";
  if (kind === "data") return "Data artifact";
  if (kind === "diagram") return "Diagram";
  if (kind === "text") return "Text artifact";
  return kind.toUpperCase();
}
function formatDuration(ms: number) { if (!ms || ms < 0) return "—"; if (ms < 1000) return `${Math.round(ms)}ms`; if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`; return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`; }
function formatEventTime(at: number) { return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }); }
function formatAge(ms: number) { if (ms < 2_000) return "now"; if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`; if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`; return `${Math.round(ms / 3_600_000)}h ago`; }
