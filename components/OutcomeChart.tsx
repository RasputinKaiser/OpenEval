"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, Shrink } from "lucide-react";
import type { SeriesPoint, Marker, MarkerKind, OutcomeSeriesEvidence } from "@/lib/insights/timeline";
import type { ChangePoint } from "@/lib/insights/changepoints";
import { fmtDate, fmtPct, fmtSigned } from "@/lib/format";
import { ChartTooltip, useChartTooltip } from "./ChartTooltip";
import { KIND_COLOR, KIND_LABEL } from "./markerKinds";

/**
 * The timeline's centerpiece: the inferred-outcome curve with every adoption
 * (skills, plugins, subagents, models) dotted along the time axis and every
 * detected metric shift flagged — "marker points and performance points" on
 * one canvas. Pure SVG, no chart library. A crosshair snaps to the nearest
 * curve point; markers and shifts carry their own hover targets.
 *
 * The SVG renders at the container's real pixel width (ResizeObserver), not a
 * stretched fixed viewBox — text stays crisp and the aspect stays sane at any
 * window size. Adoption dots live in one fixed lane per kind, clustered by
 * pixel proximity, so a dense adoption week reads as a few sized dots instead
 * of an overlapping pile.
 */


const LANES: MarkerKind[] = ["skill", "mcp", "subagent", "model"];
const CLUSTER_PX = 14;
const MIN_CHART_WIDTH = 480;
const PLOT_HEIGHT = 174;
const LANE_GAP = 12;
// The series is downsampled to ~80 points, so extreme zoom reveals nothing new;
// 16× is enough to pull apart the densest adoption weeks.
const MAX_ZOOM = 16;
const ZOOM_STEP = 1.5;

interface MarkerCluster {
  kind: MarkerKind;
  x: number;
  markers: Marker[];
}

function markerScopeLabel(marker: Marker): string {
  return marker.observedIn === "child"
    ? "child traces only"
    : marker.observedIn === "both"
      ? "top-level + child traces"
      : "top-level traces";
}

export default function OutcomeChart({
  series,
  markers,
  changePoints,
  evidence,
}: {
  series: SeriesPoint[];
  markers: Marker[];
  changePoints: ChangePoint[];
  evidence?: OutcomeSeriesEvidence;
}) {
  const { tip, pinned, show, showAt, hide, togglePin } = useChartTooltip();
  const [cross, setCross] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(900);
  const [zoom, setZoom] = useState(1);
  const titleId = useId();
  const descriptionId = useId();
  const scrollHintId = useId();
  const areaGradientId = `outcome-area-${useId().replace(/:/g, "")}`;
  const evidenceBasis = evidence?.pool === "judged"
    ? "LLM-judged sessions only"
    : evidence?.provenance === "mixed"
      ? "mixed judged + heuristic signal"
      : evidence?.provenance === "heuristic"
        ? "heuristic signal"
        : evidence?.provenance === "judged"
          ? "judged signal"
        : evidence?.provenance === "unavailable"
          ? "no usable outcome signal"
          : "outcome signal";
  const evidenceCopy = evidence
    ? `${evidenceBasis} · source n=${evidence.n}/${evidence.denominator} top-level (${fmtPct(evidence.coverage)}) · ${series.length} plotted points`
    : `${series.length} plotted points · source denominator unavailable in this snapshot`;
  // Time position to keep fixed across a zoom change: {frac of content, px offset in viewport}.
  const pendingAnchor = useRef<{ frac: number; offset: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width;
      if (cw) setContainerW(Math.max(1, Math.floor(cw)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = Math.round(Math.max(MIN_CHART_WIDTH, containerW) * zoom);
  const isOverflowing = W > containerW;

  // When a pinned tip dismisses (Escape / tap away), retire the crosshair too.
  useEffect(() => {
    if (!tip) setCross(null);
  }, [tip]);

  /** Multiply zoom, keeping the time under `anchorClientX` (default: viewport center) in place. */
  const zoomBy = useCallback((factor: number, anchorClientX?: number) => {
    const wrap = wrapRef.current;
    if (wrap) {
      const rect = wrap.getBoundingClientRect();
      const offset = anchorClientX != null ? anchorClientX - rect.left : wrap.clientWidth / 2;
      const curW = Math.max(1, wrap.scrollWidth);
      pendingAnchor.current = { frac: (wrap.scrollLeft + offset) / curW, offset };
    }
    // Functional update — rapid wheel ticks and double-clicks compound correctly.
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(1, z * factor)));
  }, []);

  // Restore the anchor after the wider/narrower chart has laid out.
  useLayoutEffect(() => {
    const wrap = wrapRef.current, a = pendingAnchor.current;
    if (!wrap || !a) return;
    pendingAnchor.current = null;
    wrap.scrollLeft = a.frac * wrap.scrollWidth - a.offset;
  }, [W]);

  // ctrl/cmd + wheel (and macOS pinch, which arrives as ctrl+wheel) zooms at the
  // pointer. Native listener: React's onWheel is passive, so it can't preventDefault.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * 0.005), e.clientX);
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  if (series.length < 2) {
    return (
      <div className="timeline-chart-empty" role="status">
        <strong>{series.length === 0 ? "No outcome history yet" : "Not enough history to chart yet"}</strong>
        <span>{series.length === 0 ? `The trend appears after at least two observations with usable outcome evidence. ${evidenceCopy}.` : `One signal point is not enough to show a trend without implying a change. ${evidenceCopy}.`}</span>
      </div>
    );
  }
  const PAD_L = 42, PAD_R = 12, PAD_T = 12;
  const t0 = series[0].at, t1 = series[series.length - 1].at;
  const span = Math.max(1, t1 - t0);
  const latest = series[series.length - 1];
  const minValue = Math.min(...series.map((point) => point.value));
  const maxValue = Math.max(...series.map((point) => point.value));
  const x = (at: number) => PAD_L + ((at - t0) / span) * (W - PAD_L - PAD_R);
  const inRange = (at: number) => at >= t0 && at <= t1;
  const shownKinds = LANES.filter((kind) => markers.some((marker) => marker.kind === kind && inRange(marker.firstSeenAt)));
  const shownShifts = changePoints.filter((c) => inRange(c.at) && c.metric === "outcome");
  const laneCount = shownKinds.length;
  const PAD_B = laneCount > 0 ? 26 + laneCount * LANE_GAP + 4 : 28;
  const H = PAD_T + PLOT_HEIGHT + PAD_B;
  const y = (v: number) => PAD_T + (1 - v) * (H - PAD_T - PAD_B);

  const path = series.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${path} L${x(t1).toFixed(1)},${y(0)} L${x(t0).toFixed(1)},${y(0)} Z`;

  // One fixed lane per kind; within a lane, markers closer than CLUSTER_PX
  // merge into a single sized dot whose tooltip lists them.
  const clusters: MarkerCluster[] = [];
  for (const kind of LANES) {
    const inLane = markers
      .filter((m) => m.kind === kind && inRange(m.firstSeenAt))
      .sort((a, b) => a.firstSeenAt - b.firstSeenAt);
    let cur: MarkerCluster | null = null;
    for (const m of inLane) {
      const mx = x(m.firstSeenAt);
      if (cur && mx - cur.x <= CLUSTER_PX) {
        cur.markers.push(m);
      } else {
        cur = { kind, x: mx, markers: [m] };
        clusters.push(cur);
      }
    }
  }
  const laneY = (kind: MarkerKind) => H - PAD_B + 26 + shownKinds.indexOf(kind) * LANE_GAP;

  const months: number[] = [];
  const d = new Date(t0);
  d.setDate(1); d.setHours(0, 0, 0, 0); d.setMonth(d.getMonth() + 1);
  while (d.getTime() < t1) { months.push(d.getTime()); d.setMonth(d.getMonth() + 1); }
  const axisTicks = [...new Set([t0, ...months, t1])];
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const tickLabel = (at: number, index: number) => {
    const iso = fmtDate(at);
    const month = monthNames[Number(iso.slice(5, 7)) - 1] ?? iso.slice(5, 7);
    const previousYear = index > 0 ? fmtDate(axisTicks[index - 1]).slice(0, 4) : "";
    return index === 0 || index === axisTicks.length - 1 || iso.slice(0, 4) !== previousYear ? `${month} ${iso.slice(0, 4)}` : month;
  };

  const nearestIdx = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / Math.max(rect.width, 1)) * W;
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < series.length; i++) {
      const dist = Math.abs(x(series[i].at) - sx);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    return best;
  };

  const pointTip = (p: SeriesPoint) => (
    <div>
      <div><span className="font-medium tabular-nums">{p.value.toFixed(2)}</span><span className="text-fg-muted"> outcome</span></div>
      <div className="text-fg-dim mono">{fmtDate(p.at)} · trailing median · n={p.n}</div>
    </div>
  );

  // Crosshair: map pointer → viewBox x → nearest series point (readers aim at
  // a date, never at a 2px line).
  const onPlotMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (pinned) return; // a pinned tip holds the crosshair too
    const best = nearestIdx(e);
    setCross(best);
    show(e, pointTip(series[best]));
  };

  // Tap/click anywhere on the plot pins the nearest point — hoverless devices
  // get the same reading the crosshair gives mouse users.
  const onPlotClick = (e: React.MouseEvent<SVGSVGElement>) => {
    e.stopPropagation();
    const best = nearestIdx(e);
    setCross(best);
    togglePin(e, pointTip(series[best]), `pt-${series[best].at}`);
  };

  // The plot itself is a keyboard target as well as a pointer surface. Arrow
  // navigation keeps the same nearest-point semantics as the crosshair, while
  // Enter/Space pins the currently selected observation for touch-equivalent
  // reading without changing the underlying series or denominators.
  const onPlotFocus = (e: React.FocusEvent<SVGSVGElement>) => {
    const best = cross ?? series.length - 1;
    setCross(best);
    showAt(e.currentTarget, pointTip(series[best]));
  };
  const onPlotKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    const current = cross ?? series.length - 1;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const next = e.key === "Home" ? 0 : e.key === "End" ? series.length - 1 : Math.min(series.length - 1, Math.max(0, current + (e.key === "ArrowRight" ? 1 : -1)));
      setCross(next);
      showAt(e.currentTarget, pointTip(series[next]));
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      setCross(current);
      togglePin({ clientX: 0, clientY: 0, currentTarget: e.currentTarget }, pointTip(series[current]), `pt-${series[current].at}`);
    }
  };

  return (
    <div className="timeline-chart relative">
      <div className="timeline-chart-toolbar flex items-center justify-between gap-3 mb-2">
        <div className="timeline-chart-toolbar-copy min-w-0">
          <span className="text-[10px] uppercase tracking-[0.12em] text-fg-dim">Observed outcome trend</span>
          <span className="timeline-chart-toolbar-subcopy">Trailing median · outcome 0–1 · {evidenceCopy}</span>
        </div>
        <div className="timeline-chart-toolbar-actions">
          <div className="timeline-chart-kpi" title={`Latest observed trailing median on ${fmtDate(latest.at)}`}>
            <span>Latest</span>
            <strong>{latest.value.toFixed(2)}</strong>
          </div>
          <div className="timeline-chart-kpi timeline-chart-kpi-range" title={`Observed range from ${fmtDate(t0)} to ${fmtDate(t1)}`}>
            <span>Observed range</span>
            <strong>{minValue.toFixed(2)}–{maxValue.toFixed(2)}</strong>
          </div>
          <div className="timeline-chart-controls flex items-center gap-0.5 rounded-md border border-bd bg-bg-subtle px-1 py-0.5" aria-label="Chart controls">
        <button
          type="button"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          disabled={zoom <= 1}
          title="Zoom out (or ctrl/⌘ + scroll on the chart)"
          aria-label="Zoom out"
          className="min-h-8 min-w-8 rounded p-1 text-fg-dim outline-none hover:bg-bg-elev hover:text-fg focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ZoomOut className="size-3.5" />
        </button>
        <span className="mono tabular-nums text-[10px] text-fg-muted min-w-9 text-center select-none" aria-live="polite">{zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}×</span>
        <button
          type="button"
          onClick={() => zoomBy(ZOOM_STEP)}
          disabled={zoom >= MAX_ZOOM}
          title="Zoom in (or ctrl/⌘ + scroll on the chart) — pan with the scrollbar below"
          aria-label="Zoom in"
          className="min-h-8 min-w-8 rounded p-1 text-fg-dim outline-none hover:bg-bg-elev hover:text-fg focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ZoomIn className="size-3.5" />
        </button>
        {zoom > 1 && (
          <button
            type="button"
            onClick={() => zoomBy(1 / zoom)}
            title="Fit to width"
            aria-label="Fit to width"
            className="min-h-8 min-w-8 rounded p-1 text-fg-dim outline-none hover:bg-bg-elev hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Shrink className="size-3.5" />
          </button>
        )}
          </div>
        </div>
      </div>

      <div
        ref={wrapRef}
        className="timeline-chart-scroll relative overflow-x-auto overscroll-x-contain pb-1"
        role="region"
        tabIndex={0}
        aria-label="Outcome timeline plot. Scroll horizontally to inspect the full date range."
        aria-describedby={`${descriptionId}${isOverflowing ? ` ${scrollHintId}` : ""}`}
        data-overflow={isOverflowing ? "true" : "false"}
      >
      <div className="relative" style={{ width: W, minWidth: W }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="block timeline-chart-svg"
        role="group"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-keyshortcuts="ArrowLeft ArrowRight Home End Enter Space"
        tabIndex={0}
        onFocus={onPlotFocus}
        onKeyDown={onPlotKeyDown}
        onMouseMove={onPlotMove}
        onClick={onPlotClick}
        onMouseLeave={() => { if (!pinned) { hide(); setCross(null); } }}
      >
        <defs>
          <linearGradient id={areaGradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent-soft)" stopOpacity="0.24" />
            <stop offset="72%" stopColor="var(--color-accent)" stopOpacity="0.06" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect
          x={PAD_L}
          y={PAD_T}
          width={Math.max(0, W - PAD_L - PAD_R)}
          height={PLOT_HEIGHT}
          rx={8}
          fill="var(--color-bg)"
          className="timeline-chart-plot-surface"
        />
        <rect
          x={PAD_L}
          y={PAD_T + PLOT_HEIGHT}
          width={Math.max(0, W - PAD_L - PAD_R)}
          height={Math.max(0, PAD_B)}
          fill="var(--color-bg-subtle)"
          className="timeline-chart-context-surface"
        />
        <title id={titleId}>Outcome trend timeline</title>
        <desc id={descriptionId}>Observed trailing median outcome points from {fmtDate(t0)} to {fmtDate(t1)}. Evidence basis: {evidenceCopy}. Straight segments connect observed points; values between observations are not measured.</desc>
        {/* y gridlines at 0 / .5 / 1 — labels live in the pinned overlay so they survive panning */}
        {[0, 0.5, 1].map((v) => (
          <line key={v} x1={PAD_L} y1={y(v)} x2={W - PAD_R} y2={y(v)} stroke="var(--color-bd)" strokeWidth={v === 0.5 ? 1 : 0.5} strokeDasharray={v === 0.5 ? "3 4" : undefined} />
        ))}
        {/* month gridlines */}
        {axisTicks.map((m, index) => (
          <g key={m}>
            <line x1={x(m)} y1={PAD_T} x2={x(m)} y2={H - PAD_B} stroke="var(--color-bd)" strokeWidth={0.5} opacity={0.6} />
            <text x={x(m)} y={H - PAD_B + 12} textAnchor={index === 0 ? "start" : index === axisTicks.length - 1 ? "end" : "middle"} fontSize={9} fill="var(--color-fg-dim)" fontFamily="ui-monospace, monospace">
              {tickLabel(m, index)}
            </text>
          </g>
        ))}

        {laneCount > 0 && (
          <>
            <line x1={PAD_L} y1={PAD_T + PLOT_HEIGHT + 1} x2={W - PAD_R} y2={PAD_T + PLOT_HEIGHT + 1} stroke="var(--color-bd)" strokeWidth={1} />
            {shownKinds.map((kind) => (
              <line key={`lane-${kind}`} x1={PAD_L} y1={laneY(kind) + 7} x2={W - PAD_R} y2={laneY(kind) + 7} stroke="var(--color-bd)" strokeWidth={0.5} opacity={0.45} />
            ))}
          </>
        )}

        {/* detected outcome shifts — vertical flags */}
        {shownShifts.map((c) => {
          const shiftTip = (
            <div>
              <div><span className="font-medium">Shift {fmtSigned(c.delta)}</span><span className="text-fg-muted"> (z={c.zScore.toFixed(1)})</span></div>
              <div className="text-fg-dim mono">{fmtDate(c.at)} · {c.nearMarkers[0] ?? "unattributed"}</div>
            </div>
          );
          return (
            <g key={c.at}>
              <line
                x1={x(c.at)} y1={PAD_T + 1} x2={x(c.at)} y2={PAD_T + PLOT_HEIGHT}
                stroke={c.delta > 0 ? "var(--color-ok)" : "var(--color-err)"}
                strokeWidth={1.25} strokeDasharray="4 3" opacity={0.65}
              />
              <circle cx={x(c.at)} cy={PAD_T + 2} r={2.75} fill={c.delta > 0 ? "var(--color-ok)" : "var(--color-err)"} opacity={0.9} />
              <rect
                x={x(c.at) - 6} y={PAD_T - 2} width={12} height={PLOT_HEIGHT + 4} fill="transparent"
                className="timeline-chart-mark timeline-chart-shift-mark cursor-help"
                tabIndex={0}
                role="button"
                aria-pressed={tip?.pinKey === `shift-${c.at}`}
                aria-label={`Detected shift ${fmtSigned(c.delta)} on ${fmtDate(c.at)} — show details`}
                onMouseMove={(e) => {
                  if (pinned) return;
                  e.stopPropagation();
                  setCross(null);
                  show(e, shiftTip);
                }}
                onFocus={(e) => { setCross(null); showAt(e.currentTarget, shiftTip); }}
                onBlur={() => hide()}
                onClick={(e) => { e.stopPropagation(); togglePin(e, shiftTip, `shift-${c.at}`); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    togglePin({ clientX: 0, clientY: 0, currentTarget: e.currentTarget }, shiftTip, `shift-${c.at}`);
                  }
                }}
              />
            </g>
          );
        })}

        <path d={area} fill={`url(#${areaGradientId})`} />
        <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth={4.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.16} />
        <path d={path} fill="none" stroke="var(--color-accent-soft)" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(latest.at)} cy={y(latest.value)} r={4.25} fill="var(--color-accent-soft)" stroke="var(--color-bg)" strokeWidth={2} className="timeline-chart-latest-point" />
        <g className="timeline-chart-latest-label" pointerEvents="none">
          <rect x={Math.max(PAD_L + 4, x(latest.at) - 42)} y={Math.max(PAD_T + 5, y(latest.value) - 28)} width={36} height={17} rx={8.5} fill="var(--color-accent)" />
          <text x={Math.max(PAD_L + 22, x(latest.at) - 24)} y={Math.max(PAD_T + 16.5, y(latest.value) - 16.5)} textAnchor="middle" fontSize={9} fontWeight={600} fill="var(--color-bg)" fontFamily="ui-monospace, monospace">{latest.value.toFixed(2)}</text>
        </g>

        {/* crosshair — hairline + snapped point with a surface ring */}
        {cross != null && (
          <g pointerEvents="none">
            <line x1={x(series[cross].at)} y1={PAD_T} x2={x(series[cross].at)} y2={H - PAD_B} stroke="var(--color-fg-dim)" strokeWidth={0.75} opacity={0.6} />
            <circle cx={x(series[cross].at)} cy={y(series[cross].value)} r={3.5} fill="var(--color-accent-soft)" stroke="var(--color-bg)" strokeWidth={2} />
          </g>
        )}

        {/* adoption lanes — one row per kind, proximity-clustered dots */}
        {clusters.map((c) => {
          const n = c.markers.length;
          const r = Math.min(6, 3 + (n - 1) * 0.9);
          const key = `${c.kind}-${c.x.toFixed(0)}`;
          const scopes = [...new Set(c.markers.map(markerScopeLabel))];
          const scopeLabel = scopes.length === 1 ? scopes[0] : "mixed trace scopes";
          const clusterTip = (
            <div>
              <div className="font-medium">{n} {KIND_LABEL[c.kind]}{n === 1 ? "" : "s"} adopted</div>
              <div className="text-fg-dim">Observed in {scopeLabel}; child-only evidence is not a top-level outcome denominator.</div>
              {c.markers.slice(0, 6).map((m) => (
                <div key={m.name} className="text-fg-muted flex justify-between gap-3">
                  <span className="truncate max-w-[190px]">{m.name}</span>
                  <span className="text-fg-dim mono shrink-0">{fmtDate(m.firstSeenAt).slice(5)} ·×{m.sessionCount}</span>
                </div>
              ))}
              {n > 6 && <div className="text-fg-dim">+{n - 6} more</div>}
            </div>
          );
          return (
            <circle
              key={key}
              cx={c.x}
              cy={laneY(c.kind)}
              r={r}
              fill={KIND_COLOR[c.kind]}
              stroke="var(--color-bg-subtle)"
              strokeWidth={1.5}
              opacity={c.kind === "model" ? 0.55 : 0.9}
              className="timeline-chart-mark timeline-chart-adoption-mark cursor-help"
              tabIndex={0}
              role="button"
              aria-pressed={tip?.pinKey === `cluster-${key}`}
              aria-label={`${n} ${KIND_LABEL[c.kind]}${n === 1 ? "" : "s"} adopted around ${fmtDate(c.markers[0].firstSeenAt)} (${scopeLabel}) — show details`}
              onMouseMove={(e) => {
                if (pinned) return;
                e.stopPropagation();
                setCross(null);
                show(e, clusterTip);
              }}
              onFocus={(e) => { setCross(null); showAt(e.currentTarget, clusterTip); }}
              onBlur={() => hide()}
              onClick={(e) => { e.stopPropagation(); togglePin(e, clusterTip, `cluster-${key}`); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  togglePin({ clientX: 0, clientY: 0, currentTarget: e.currentTarget }, clusterTip, `cluster-${key}`);
                }
              }}
            />
          );
        })}
      </svg>
      </div>

      {/* Pinned axis gutter — y values and lane names stay put while the chart pans. */}
      <div
        className="timeline-chart-axis-gutter pointer-events-none absolute left-0 top-0 z-[5]"
        style={{ width: PAD_L, height: H, background: "linear-gradient(to right, var(--color-bg-subtle) 60%, transparent)" }}
        aria-hidden
      >
        {[1, 0.5, 0].map((v) => (
          <span key={v} className="absolute right-[6px] -translate-y-1/2 text-[9px] mono text-fg-dim leading-none" style={{ top: y(v) }}>
            {v.toFixed(1)}
          </span>
        ))}
        {shownKinds.map((k) => (
          <span key={k} className="absolute right-[6px] -translate-y-1/2 text-[8px] mono leading-none" style={{ top: laneY(k), color: KIND_COLOR[k] }}>
            {k === "subagent" ? "agent" : KIND_LABEL[k]}
          </span>
        ))}
      </div>
      </div>

      {isOverflowing && <p id={scrollHintId} className="timeline-chart-scroll-hint">Swipe or shift-scroll to inspect the full date range.</p>}

      <ChartTooltip tip={tip} />

      <div className="timeline-chart-legend flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[10px] text-fg-dim" role="list" aria-label="Outcome chart legend">
        <span className="inline-flex items-center gap-1.5" role="listitem"><span className="w-4 h-0.5 rounded" style={{ background: "var(--color-accent-soft)" }} /> outcome (trailing median)</span>
        {shownKinds.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5" role="listitem">
            <span className="size-2 rounded-full" style={{ background: KIND_COLOR[k] }} /> {KIND_LABEL[k]} adopted
          </span>
        ))}
        {shownShifts.length > 0 && <span className="inline-flex items-center gap-1.5" role="listitem"><span className="inline-flex items-center gap-0.5"><span className="w-2 h-0.5 rounded bg-ok" /><span className="w-2 h-0.5 rounded bg-err" /></span> global detected shift (up / down)</span>}
        {shownKinds.length === 0 && <span className="timeline-chart-legend-note" role="listitem">No adoption markers in this range</span>}
      </div>
    </div>
  );
}
