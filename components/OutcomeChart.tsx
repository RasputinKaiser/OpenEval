"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ZoomIn, ZoomOut, Shrink } from "lucide-react";
import type { SeriesPoint, Marker, MarkerKind } from "@/lib/insights/timeline";
import type { ChangePoint } from "@/lib/insights/changepoints";
import { fmtDate, fmtSigned } from "@/lib/format";
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
// The series is downsampled to ~80 points, so extreme zoom reveals nothing new;
// 16× is enough to pull apart the densest adoption weeks.
const MAX_ZOOM = 16;
const ZOOM_STEP = 1.5;

interface MarkerCluster {
  kind: MarkerKind;
  x: number;
  markers: Marker[];
}

export default function OutcomeChart({
  series,
  markers,
  changePoints,
}: {
  series: SeriesPoint[];
  markers: Marker[];
  changePoints: ChangePoint[];
}) {
  const { tip, show, hide } = useChartTooltip();
  const [cross, setCross] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [measuredW, setMeasuredW] = useState(900);
  const [zoom, setZoom] = useState(1);
  // Time position to keep fixed across a zoom change: {frac of content, px offset in viewport}.
  const pendingAnchor = useRef<{ frac: number; offset: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width;
      if (cw) setMeasuredW(Math.max(640, Math.floor(cw)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = Math.round(measuredW * zoom), H = 264;

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
    return <div className="text-center py-8 text-sm text-fg-dim">Not enough history to chart yet.</div>;
  }
  const PAD_L = 34, PAD_R = 10, PAD_T = 12, PAD_B = 78;
  const t0 = series[0].at, t1 = series[series.length - 1].at;
  const span = Math.max(1, t1 - t0);
  const x = (at: number) => PAD_L + ((at - t0) / span) * (W - PAD_L - PAD_R);
  const y = (v: number) => PAD_T + (1 - v) * (H - PAD_T - PAD_B);

  const path = series.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${path} L${x(t1).toFixed(1)},${y(0)} L${x(t0).toFixed(1)},${y(0)} Z`;

  const inRange = (at: number) => at >= t0 && at <= t1;
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
  const laneY = (kind: MarkerKind) => H - PAD_B + 26 + LANES.indexOf(kind) * 12;
  const shownShifts = changePoints.filter((c) => inRange(c.at) && c.metric === "outcome");

    const months: number[] = [];
  const d = new Date(t0);
  d.setDate(1); d.setHours(0, 0, 0, 0); d.setMonth(d.getMonth() + 1);
  while (d.getTime() < t1) { months.push(d.getTime()); d.setMonth(d.getMonth() + 1); }

  // Crosshair: map pointer → viewBox x → nearest series point (readers aim at
  // a date, never at a 2px line).
  const onPlotMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / Math.max(rect.width, 1)) * W;
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < series.length; i++) {
      const dist = Math.abs(x(series[i].at) - sx);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    setCross(best);
    const p = series[best];
    show(e, (
      <div>
        <div><span className="font-medium tabular-nums">{p.value.toFixed(2)}</span><span className="text-fg-muted"> outcome</span></div>
        <div className="text-fg-dim mono">{fmtDate(p.at)} · trailing median of {p.n}</div>
      </div>
    ));
  };

  return (
    <div className="relative">
      <div className="absolute top-0 right-0 z-10 flex items-center gap-0.5 rounded-md border border-bd bg-bg-subtle/85 backdrop-blur-sm px-1 py-0.5">
        <button
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          disabled={zoom <= 1}
          title="Zoom out (or ctrl/⌘ + scroll on the chart)"
          aria-label="Zoom out"
          className="rounded p-1 text-fg-dim hover:text-fg hover:bg-bg-elev disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ZoomOut className="size-3.5" />
        </button>
        <span className="mono tabular-nums text-[10px] text-fg-muted w-8 text-center select-none">{zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}×</span>
        <button
          onClick={() => zoomBy(ZOOM_STEP)}
          disabled={zoom >= MAX_ZOOM}
          title="Zoom in (or ctrl/⌘ + scroll on the chart) — pan with the scrollbar below"
          aria-label="Zoom in"
          className="rounded p-1 text-fg-dim hover:text-fg hover:bg-bg-elev disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ZoomIn className="size-3.5" />
        </button>
        {zoom > 1 && (
          <button
            onClick={() => zoomBy(1 / zoom)}
            title="Fit to width"
            aria-label="Fit to width"
            className="rounded p-1 text-fg-dim hover:text-fg hover:bg-bg-elev"
          >
            <Shrink className="size-3.5" />
          </button>
        )}
      </div>

      <div ref={wrapRef} className="relative overflow-x-auto overscroll-x-contain pb-1">
      <div className="relative" style={{ width: W }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="block"
        onMouseMove={onPlotMove}
        onMouseLeave={() => { hide(); setCross(null); }}
      >
        {/* y gridlines at 0 / .5 / 1 — labels live in the pinned overlay so they survive panning */}
        {[0, 0.5, 1].map((v) => (
          <line key={v} x1={PAD_L} y1={y(v)} x2={W - PAD_R} y2={y(v)} stroke="var(--color-bd)" strokeWidth={v === 0.5 ? 1 : 0.5} strokeDasharray={v === 0.5 ? "3 4" : undefined} />
        ))}
        {/* month gridlines */}
        {months.map((m) => (
          <g key={m}>
            <line x1={x(m)} y1={PAD_T} x2={x(m)} y2={H - PAD_B} stroke="var(--color-bd)" strokeWidth={0.5} opacity={0.6} />
            <text x={x(m)} y={H - PAD_B + 12} textAnchor="middle" fontSize={9} fill="var(--color-fg-dim)" fontFamily="ui-monospace, monospace">
              {new Date(m).toLocaleDateString(undefined, { month: "short" })}
            </text>
          </g>
        ))}

        {/* detected outcome shifts — vertical flags */}
        {shownShifts.map((c) => (
          <g key={c.at}>
            <line
              x1={x(c.at)} y1={PAD_T} x2={x(c.at)} y2={H - PAD_B}
              stroke={c.delta > 0 ? "var(--color-ok)" : "var(--color-err)"}
              strokeWidth={1.5} strokeDasharray="4 3" opacity={0.7}
            />
            <rect
              x={x(c.at) - 6} y={PAD_T - 2} width={12} height={H - PAD_T - PAD_B} fill="transparent" className="cursor-help"
              onMouseMove={(e) => {
                e.stopPropagation();
                setCross(null);
                show(e, (
                  <div>
                    <div><span className="font-medium">Shift {fmtSigned(c.delta)}</span><span className="text-fg-muted"> (z={c.zScore.toFixed(1)})</span></div>
                    <div className="text-fg-dim mono">{fmtDate(c.at)} · {c.nearMarkers[0] ?? "unattributed"}</div>
                  </div>
                ));
              }}
            />
          </g>
        ))}

                <path d={area} fill="var(--color-accent)" opacity={0.08} />
        <path d={path} fill="none" stroke="var(--color-accent-soft)" strokeWidth={1.75} strokeLinejoin="round" />

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
          return (
            <circle
              key={`${c.kind}-${c.x.toFixed(0)}`}
              cx={c.x}
              cy={laneY(c.kind)}
              r={r}
              fill={KIND_COLOR[c.kind]}
              opacity={c.kind === "model" ? 0.55 : 0.9}
              className="cursor-help"
              onMouseMove={(e) => {
                e.stopPropagation();
                setCross(null);
                show(e, (
                  <div>
                    <div className="font-medium">{n} {KIND_LABEL[c.kind]}{n === 1 ? "" : "s"} adopted</div>
                    {c.markers.slice(0, 6).map((m) => (
                      <div key={m.name} className="text-fg-muted flex justify-between gap-3">
                        <span className="truncate max-w-[190px]">{m.name}</span>
                        <span className="text-fg-dim mono shrink-0">{fmtDate(m.firstSeenAt).slice(5)} ·×{m.sessionCount}</span>
                      </div>
                    ))}
                    {n > 6 && <div className="text-fg-dim">+{n - 6} more</div>}
                  </div>
                ));
              }}
            />
          );
        })}
      </svg>
      </div>
      </div>

      {/* Pinned axis gutter — y values and lane names stay put while the chart pans. */}
      <div
        className="pointer-events-none absolute left-0 top-0 z-[5]"
        style={{ width: PAD_L, height: H, background: "linear-gradient(to right, var(--color-bg-subtle) 60%, transparent)" }}
        aria-hidden
      >
        {[1, 0.5, 0].map((v) => (
          <span key={v} className="absolute right-[6px] -translate-y-1/2 text-[9px] mono text-fg-dim leading-none" style={{ top: y(v) }}>
            {v.toFixed(1)}
          </span>
        ))}
        {LANES.map((k) => (
          <span key={k} className="absolute right-[6px] -translate-y-1/2 text-[8px] mono leading-none" style={{ top: laneY(k), color: KIND_COLOR[k] }}>
            {k === "subagent" ? "agent" : KIND_LABEL[k]}
          </span>
        ))}
      </div>

      <ChartTooltip tip={tip} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[10px] text-fg-dim">
        <span className="inline-flex items-center gap-1.5"><span className="w-4 h-0.5 rounded" style={{ background: "var(--color-accent-soft)" }} /> outcome (trailing median)</span>
        {(["skill", "mcp", "subagent", "model"] as MarkerKind[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: KIND_COLOR[k] }} /> {KIND_LABEL[k]} adopted
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span className={clsx("w-3 h-0.5 border-t border-dashed")} style={{ borderColor: "var(--color-err)" }} /> detected shift</span>
      </div>
    </div>
  );
}
