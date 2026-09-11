"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, Shrink } from "lucide-react";
import type { SeriesPoint, Marker, MarkerKind, OutcomeSeriesEvidence } from "@/lib/insights/timeline";
import type { ChangePoint } from "@/lib/insights/changepoints";
import { fmtDate, fmtInt, fmtPct, fmtSigned } from "@/lib/format";
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
const PLOT_HEIGHT = 244;
const LANE_GAP = 14;
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
  // Defense in depth: a NaN/Infinity value anywhere in the series would silently break the
  // SVG path ("M42,NaN"). The upstream series is NaN-safe by contract; this guard keeps a
  // malformed snapshot from rendering a broken chart instead of an honest error state.
  const cleanSeries = series.filter((p) => Number.isFinite(p.value) && Number.isFinite(p.at));
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
    ? `${evidenceBasis}\u00a0· source n=${fmtInt(evidence.n)}/${fmtInt(evidence.denominator)} top-level (${fmtPct(evidence.coverage)})\u00a0· ${cleanSeries.length} plotted points`
    : `${cleanSeries.length} plotted points · source denominator unavailable in this snapshot`;
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

  // --- Brush zoom state (must precede the early return to keep hook order stable) ---
  const [brush, setBrush] = useState<{ x0: number; x1: number } | null>(null);
  const brushRef = useRef<{ startX: number } | null>(null);
  // A data refresh that changes the series invalidates any in-progress brush window.

  const seriesLength = series.length;
  const seriesFirstAt = series[0]?.at;
  const seriesLastAt = series[seriesLength - 1]?.at;
  useEffect(() => {
    brushRef.current = null;
    setBrush(null);
  }, [seriesLength, seriesFirstAt, seriesLastAt]);

  if (cleanSeries.length < 2) {
    return (
      <div className="timeline-chart-empty" role="status">
        <strong>{series.length === 0 ? "No outcome history yet" : cleanSeries.length === 0 ? "No readable outcome points in this snapshot" : "Not enough history to chart yet"}</strong>
        <span>{series.length === 0 ? `The trend appears after at least two observations with usable outcome evidence. ${evidenceCopy}.` : cleanSeries.length === 0 ? `Every observation in this snapshot had a malformed value and was excluded from the chart rather than rendered as zero. ${evidenceCopy}.` : `One signal point is not enough to show a trend without implying a change. ${evidenceCopy}.`}</span>
      </div>
    );
  }
  const PAD_L = 42, PAD_R = 12, PAD_T = 12;
  const t0 = cleanSeries[0].at, t1 = cleanSeries[cleanSeries.length - 1].at;
  const span = Math.max(1, t1 - t0);
  const latest = cleanSeries[cleanSeries.length - 1];
  const x = (at: number) => PAD_L + ((at - t0) / span) * (W - PAD_L - PAD_R);
  const inRange = (at: number) => at >= t0 && at <= t1;
  const shownKinds = LANES.filter((kind) => markers.some((marker) => marker.kind === kind && inRange(marker.firstSeenAt)));
  const shownShifts = changePoints.filter((c) => Number.isFinite(c.at) && Number.isFinite(c.delta) && inRange(c.at) && c.metric === "outcome");
  const laneCount = shownKinds.length;
  const PAD_B = laneCount > 0 ? 26 + laneCount * LANE_GAP + 4 : 28;
  const H = PAD_T + PLOT_HEIGHT + PAD_B;
  const y = (v: number) => PAD_T + (1 - v) * (H - PAD_T - PAD_B);

  const path = cleanSeries.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${path} L${x(t1).toFixed(1)},${y(0)} L${x(t0).toFixed(1)},${y(0)} Z`;

  // One fixed lane per kind; within a lane, markers closer than CLUSTER_PX
  // merge into a single sized dot whose tooltip lists them.
  const clusters: MarkerCluster[] = [];
  for (const kind of LANES) {
    const inLane = markers
      .filter((m) => m.kind === kind && Number.isFinite(m.firstSeenAt) && inRange(m.firstSeenAt))
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

  const maxN = Math.max(1, ...cleanSeries.map((p) => (Number.isFinite(p.n) ? Math.min(p.n, 60) : 0)));
  const months: number[] = [];
  const d = new Date(t0);
  d.setDate(1); d.setHours(0, 0, 0, 0); d.setMonth(d.getMonth() + 1);
  while (d.getTime() < t1) { months.push(d.getTime()); d.setMonth(d.getMonth() + 1); }
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const allTicks = [...new Set([t0, ...months, t1])];
  // Geometry-aware thinning: a 9px mono label is ~5.6px/char. Walk ticks left-to-right and drop
  // any interior tick whose label box (mid-anchored) would overlap the previous KEPT label's
  // box. Terminal ticks keep their year suffix and their own anchoring.
  const labelWidth = (t: number, i: number) => {
    const iso = fmtDate(t);
    const m = monthNames[Number(iso.slice(5, 7)) - 1] ?? iso.slice(5, 7);
    const withYear = i === 0 || i === allTicks.length - 1 || (i > 0 && fmtDate(allTicks[i - 1]).slice(0, 4) !== iso.slice(0, 4));
    return (withYear ? m.length + 5 : m.length) * 5.6 + 8;
  };
  const axisTicks: number[] = [];
  let prevRight = -Infinity;
  for (let i = 0; i < allTicks.length; i++) {
    const tx = x(allTicks[i]);
    const w = labelWidth(allTicks[i], i);
    const left = i === 0 ? tx : tx - w / 2;
    const right = i === allTicks.length - 1 ? tx + w : i === 0 ? tx + w : tx + w / 2;
    if (left >= prevRight - 4 || i === allTicks.length - 1) {
      if (i === allTicks.length - 1 && left < prevRight - 4 && axisTicks.length >= 2) {
        // Terminal label would collide with the previous kept tick: drop that tick instead.
        axisTicks.pop();
      }
      axisTicks.push(allTicks[i]);
      prevRight = right;
    }
  }
  const tickLabel = (at: number, index: number) => {
    const iso = fmtDate(at);
    const month = monthNames[Number(iso.slice(5, 7)) - 1] ?? iso.slice(5, 7);
    const previousYear = index > 0 ? fmtDate(axisTicks[index - 1]).slice(0, 4) : "";
    const needsYear = index === axisTicks.length - 1 || iso.slice(0, 4) !== previousYear;
    return index === 0 || needsYear ? `${month} ${iso.slice(0, 4)}` : month;
  };

  const nearestIdx = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / Math.max(rect.width, 1)) * W;
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < cleanSeries.length; i++) {
      const dist = Math.abs(x(cleanSeries[i].at) - sx);
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
    show(e, pointTip(cleanSeries[best]));
  };

  // Tap/click anywhere on the plot pins the nearest point — hoverless devices
  // get the same reading the crosshair gives mouse users.
  const onPlotClick = (e: React.MouseEvent<SVGSVGElement>) => {
    e.stopPropagation();
    const best = nearestIdx(e);
    setCross(best);
    togglePin(e, pointTip(cleanSeries[best]), `pt-${cleanSeries[best].at}`);
  };

  // The plot itself is a keyboard target as well as a pointer surface. Arrow
  // navigation keeps the same nearest-point semantics as the crosshair, while
  // Enter/Space pins the currently selected observation for touch-equivalent
  // reading without changing the underlying series or denominators.
  const onPlotFocus = (e: React.FocusEvent<SVGSVGElement>) => {
    const best = cross ?? cleanSeries.length - 1;
    setCross(best);
    showAt(e.currentTarget, pointTip(cleanSeries[best]));
  };
  const onPlotKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    const current = cross ?? cleanSeries.length - 1;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const next = e.key === "Home" ? 0 : e.key === "End" ? cleanSeries.length - 1 : Math.min(cleanSeries.length - 1, Math.max(0, current + (e.key === "ArrowRight" ? 1 : -1)));
      setCross(next);
      showAt(e.currentTarget, pointTip(cleanSeries[next]));
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      setCross(current);
      togglePin({ clientX: 0, clientY: 0, currentTarget: e.currentTarget }, pointTip(cleanSeries[current]), `pt-${cleanSeries[current].at}`);
    }
  };

  // --- Brush zoom: drag horizontally on the plot to zoom into that time range. ---
  const svgClientX = (clientX: number, el: SVGSVGElement) => {
    const rect = el.getBoundingClientRect();
    return ((clientX - rect.left) / Math.max(rect.width, 1)) * W;
  };
  const onBrushDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0 || pinned) return;
    brushRef.current = { startX: svgClientX(e.clientX, e.currentTarget) };
    setBrush(null);
  };
  const onBrushMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!brushRef.current) return;
    const startX = brushRef.current.startX;
    const curX = svgClientX(e.clientX, e.currentTarget);
    if (Math.abs(curX - startX) > 8) setBrush({ x0: Math.min(startX, curX), x1: Math.max(startX, curX) });
    else setBrush(null);
  };
  const onBrushUp = (_e: React.MouseEvent<SVGSVGElement>) => {
    const b = brush;
    brushRef.current = null;
    setBrush(null);
    if (!b || b.x1 - b.x0 < 16) return; // too small — treat as a click (crosshair pin)
    // Convert the brushed pixel range to the series index window it covers.
    const atLo = t0 + ((b.x0 - PAD_L) / Math.max(1, W - PAD_L - PAD_R)) * span;
    const atHi = t0 + ((b.x1 - PAD_L) / Math.max(1, W - PAD_L - PAD_R)) * span;
    const idxLo = Math.max(0, cleanSeries.findIndex((p) => p.at >= atLo));
    let idxHi = cleanSeries.length - 1;
    for (let i = cleanSeries.length - 1; i >= 0; i--) { if (cleanSeries[i].at <= atHi) { idxHi = i; break; } }
    if (idxHi - idxLo < 3) return; // need a meaningful window
    // Zoom so that the selected window fills the viewport: scale = full span / window span.
    const windowSpan = Math.max(1, cleanSeries[idxHi].at - cleanSeries[idxLo].at);
    const factor = Math.min(MAX_ZOOM, Math.max(1, span / windowSpan));
    // Anchor so the window's center stays centered: set pendingAnchor to window center frac.
    const centerAt = (cleanSeries[idxLo].at + cleanSeries[idxHi].at) / 2;
    const wrap = wrapRef.current;
    if (wrap) {
      const frac = x(centerAt) / Math.max(1, containerW * factor);
      pendingAnchor.current = { frac, offset: wrap.clientWidth / 2 };
    }
    setZoom(() => Math.min(MAX_ZOOM, Math.max(1, factor)));
  };

  return (
    <div className="timeline-chart relative">
      <div className="timeline-chart-toolbar flex items-center justify-between gap-3 mb-2">
        <div className="timeline-chart-toolbar-copy min-w-0">
          <span className="timeline-chart-toolbar-label text-[10px] uppercase tracking-[0.12em] text-fg-dim">Observed outcome trend</span>
          <span className="timeline-chart-toolbar-subcopy">Trailing median · outcome 0–1 · {evidenceCopy}</span>
        </div>
        <div className="timeline-chart-toolbar-actions" aria-label="Trend summary">
          {/* Observed-range chip removed: on a 0–1 bounded metric it restates the scale, not the data.
              Latest value lives on the line's endpoint badge; the chip duplicated it. */}
          <div className="timeline-chart-controls flex items-center gap-0.5 rounded-md border border-bd bg-bg-subtle px-1 py-0.5" aria-label="Chart controls">
        <button
          type="button"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          disabled={zoom <= 1}
          title="Zoom out (or ctrl/⌘ + scroll on the chart)"
          aria-label="Zoom out"
          className="min-h-8 min-w-8 rounded p-1 text-fg-muted outline-none hover:bg-bg-elev hover:text-fg focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 disabled:hover:bg-transparent"
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
          className="min-h-8 min-w-8 rounded p-1 text-fg-muted outline-none hover:bg-bg-elev hover:text-fg focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ZoomIn className="size-3.5" />
        </button>
        {zoom > 1 && (
          <button
            type="button"
            onClick={() => zoomBy(1 / zoom)}
            title="Fit to width"
            aria-label="Fit to width"
            className="min-h-8 min-w-8 rounded p-1 text-fg-muted outline-none hover:bg-bg-elev hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Shrink className="size-3.5" />
          </button>
        )}
          </div>
        </div>
      </div>

      <div
        ref={wrapRef}
        className="chart-scroll-well timeline-chart-scroll relative overflow-x-auto overscroll-x-contain pb-1"
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
        onMouseMove={(e) => { onBrushMove(e); onPlotMove(e); }}
        onClick={onPlotClick}
        onMouseDown={onBrushDown}
        onMouseUp={onBrushUp}
        onMouseLeave={() => { brushRef.current = null; setBrush(null); if (!pinned) { hide(); setCross(null); } }}
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
          <line key={v} className={v === 0.5 ? "timeline-chart-gridline timeline-chart-gridline-major" : "timeline-chart-gridline"} x1={PAD_L} y1={y(v)} x2={W - PAD_R} y2={y(v)} stroke="var(--color-bd)" strokeWidth={v === 0.5 ? 1 : 0.5} strokeDasharray={v === 0.5 ? "3 4" : undefined} />
        ))}
        {/* month gridlines */}
        {axisTicks.map((m, index) => (
          <g key={m}>
            <line className="timeline-chart-monthline" x1={x(m)} y1={PAD_T} x2={x(m)} y2={H - PAD_B} stroke="var(--color-bd)" strokeWidth={0.5} opacity={0.6} />
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
          const shiftColor = c.delta > 0 ? "var(--color-ok)" : "var(--color-err)";
          const shiftTip = (
            <div>
              <div><span className="font-medium">Shift {fmtSigned(c.delta)}</span><span className="text-fg-muted"> (z={c.zScore.toFixed(1)}, {c.strength})</span></div>
              <div className="text-fg-dim mono">{fmtDate(c.at)} · {c.sampleBefore} obs before → {c.sampleAfter} after{c.nearMarkers[0] ? ` · near ${c.nearMarkers[0]}` : ""}</div>
            </div>
          );
          // In-chart annotation: the headline event carries its own direction + date label.
          // Multiple shifts get stacked pills (16px offset per index) so they never overlap.
          const shiftISO = fmtDate(c.at);
          const shiftMonth = monthNames[Number(shiftISO.slice(5, 7)) - 1] ?? shiftISO.slice(5, 7);
          const shiftLabelText = `${c.delta > 0 ? "up" : "down"} ${fmtSigned(c.delta)} · ${shiftMonth} ${Number(shiftISO.slice(8, 10))}`;
          const shiftLabelW = shiftLabelText.length * 5.4 + 12;
          const shiftLabelY = PAD_T + 5 + shownShifts.indexOf(c) * 16;
          const shiftLabelX = Math.min(Math.max(x(c.at) + 6, PAD_L + 2), W - PAD_R - shiftLabelW - 2);
          return (
            <g key={c.at}>
              <line
                x1={x(c.at)} y1={PAD_T + 1} x2={x(c.at)} y2={PAD_T + PLOT_HEIGHT}
                stroke={shiftColor}
                strokeWidth={1.25} strokeDasharray="4 3" opacity={0.65}
              />
              <circle cx={x(c.at)} cy={PAD_T + 2} r={2.75} fill={shiftColor} opacity={0.9} />
              <g className="timeline-chart-shift-label" pointerEvents="none">
                <rect x={shiftLabelX} y={shiftLabelY} width={shiftLabelW} height={14} rx={7} fill={shiftColor} opacity={0.92} />
                <text x={shiftLabelX + shiftLabelW / 2} y={shiftLabelY + 9.5} textAnchor="middle" fontSize={8.5} fontWeight={600} fill="var(--color-bg)" fontFamily="ui-monospace, monospace">{shiftLabelText}</text>
              </g>
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

        <path className="timeline-chart-area" d={area} fill={`url(#${areaGradientId})`} />
        <path className="timeline-chart-series-glow chart-draw" d={path} fill="none" stroke="var(--color-accent)" strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" opacity={0.16} />
        {/* Confidence scaling: a trailing median is only as trustworthy as its window. Segments
            rendered from thin windows (small n) are thinner and fainter — the well-sampled
            region reads solid, small-sample jitter visibly whispers instead of shouting. */}
        {cleanSeries.slice(0, -1).map((p, i) => {
          const q = cleanSeries[i + 1];
          const nMin = Math.min(p.n, q.n);
          const CONF_MAX_N = 12;
          const conf = Math.min(1, nMin / CONF_MAX_N);
          const segW = 1.5 + conf * 1.5;
          const segO = 0.45 + conf * 0.55;
          return (
            <path
              key={`seg-${p.at}`}
              className="chart-fade-in"
              d={`M${x(p.at).toFixed(1)},${y(p.value).toFixed(1)} L${x(q.at).toFixed(1)},${y(q.value).toFixed(1)}`}
              fill="none"
              stroke="var(--color-accent-soft)"
              strokeWidth={segW}
              strokeLinecap="round"
              opacity={segO}
            />
          );
        })}
        <circle cx={x(latest.at)} cy={y(latest.value)} r={4.25} fill="var(--color-accent-soft)" stroke="var(--color-bg)" strokeWidth={2} className="timeline-chart-latest-point" />
        <g className="timeline-chart-latest-label" pointerEvents="none">
          <rect x={Math.max(PAD_L + 4, x(latest.at) - 42)} y={Math.max(PAD_T + 5, y(latest.value) - 28)} width={36} height={17} rx={8.5} fill="var(--color-accent)" />
          <text x={Math.max(PAD_L + 22, x(latest.at) - 24)} y={Math.max(PAD_T + 16.5, y(latest.value) - 16.5)} textAnchor="middle" fontSize={9} fontWeight={600} fill="var(--color-bg)" fontFamily="ui-monospace, monospace">{latest.value.toFixed(2)}</text>
        </g>

        {/* Evidence-density strip: per-point window size (n) as bars along the plot floor.
            Grounds the confidence-scaled line — where evidence is thin, the bars are short. */}
        <g aria-hidden="true">
          {cleanSeries.map((p) => {
            if (!Number.isFinite(p.n) || p.n <= 0) return null;
            const barH = Math.max(1, (Math.min(p.n, maxN) / maxN) * 12);
            return (
              <rect
                key={`dens-${p.at}`}
                x={x(p.at) - 1.5}
                y={PAD_T + PLOT_HEIGHT - barH}
                width={3}
                height={barH}
                fill="var(--color-accent)"
                opacity={0.18}
              />
            );
          })}
        </g>

        {/* brush selection overlay */}
        {brush && (
          <g pointerEvents="none">
            <rect
              x={brush.x0} y={PAD_T} width={Math.max(1, brush.x1 - brush.x0)} height={PLOT_HEIGHT}
              fill="var(--color-accent)" opacity={0.12}
              stroke="var(--color-accent)" strokeWidth={1} strokeDasharray="3 3"
            />
          </g>
        )}

        {/* crosshair — hairline + snapped point with a surface ring */}
        {cross != null && (
          <g pointerEvents="none">
            <line x1={x(cleanSeries[cross].at)} y1={PAD_T} x2={x(cleanSeries[cross].at)} y2={H - PAD_B} stroke="var(--color-fg-dim)" strokeWidth={0.75} opacity={0.6} />
            <circle cx={x(cleanSeries[cross].at)} cy={y(cleanSeries[cross].value)} r={3.5} fill="var(--color-accent-soft)" stroke="var(--color-bg)" strokeWidth={2} />
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
          <span key={k} className="absolute right-[6px] -translate-y-1/2 text-[9px] mono leading-none" style={{ top: laneY(k), color: KIND_COLOR[k] }}>
            {KIND_LABEL[k]}
          </span>
        ))}
      </div>
      </div>

      {isOverflowing && <p id={scrollHintId} className="timeline-chart-scroll-hint">Drag on the plot to zoom into a range · shift-scroll to pan.</p>}

      <ChartTooltip tip={tip} />

      <div className="timeline-chart-legend" role="list" aria-label="Outcome chart legend">
        <span className="timeline-chart-legend-item timeline-chart-legend-item--outcome" role="listitem"><span className="w-4 h-0.5 rounded" style={{ background: "var(--color-accent-soft)" }} /> outcome (trailing median)</span>
        {shownKinds.map((k) => (
          <span key={k} className="timeline-chart-legend-item timeline-chart-legend-item--adoption" role="listitem">
            <span className="size-2 rounded-full" style={{ background: KIND_COLOR[k] }} /> {KIND_LABEL[k]} adopted
          </span>
        ))}
        {shownKinds.length > 0 && (
          <span className="timeline-chart-legend-item" role="listitem" title="Dot area grows with how many markers landed in the same week: 1, then ~4, then 6+ clustered">
            <span className="inline-flex items-end gap-[3px]" aria-hidden>
              <span className="rounded-full" style={{ width: 6, height: 6, background: "var(--color-fg-dim)" }} />
              <span className="rounded-full" style={{ width: 9, height: 9, background: "var(--color-fg-dim)" }} />
              <span className="rounded-full" style={{ width: 12, height: 12, background: "var(--color-fg-dim)" }} />
            </span>
            <span className="text-fg-dim">cluster size: 1 · few · 6+</span>
          </span>
        )}
        {shownShifts.length > 0 && <span className="timeline-chart-legend-item timeline-chart-legend-item--context" role="listitem"><span className="inline-flex items-center gap-0.5"><span className="w-2 h-0.5 rounded bg-ok" /><span className="w-2 h-0.5 rounded bg-err" /></span> detected shift (up/down)</span>}
        {shownKinds.length === 0 && <span className="timeline-chart-legend-item timeline-chart-legend-note" role="listitem">No adoption markers in this range</span>}
      </div>
    </div>
  );
}
