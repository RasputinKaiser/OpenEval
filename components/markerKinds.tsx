import { Activity, Plug, Sparkles, Users } from "lucide-react";
import type { MarkerKind } from "@/lib/insights/timeline";

/**
 * The one identity palette for adoption-marker kinds. Every surface that
 * renders markers (timeline page, outcome chart, dashboard) imports from
 * here so recoloring or relabeling a kind can't drift between charts.
 */
export const KIND_ICON: Record<MarkerKind, typeof Sparkles> = {
  skill: Sparkles,
  mcp: Plug,
  subagent: Users,
  model: Activity,
};

export const KIND_LABEL: Record<MarkerKind, string> = {
  skill: "skill",
  mcp: "plugin",
  subagent: "subagent",
  model: "model",
};

export const KIND_COLOR: Record<MarkerKind, string> = {
  skill: "color-mix(in srgb, var(--color-accent-soft) 62%, var(--color-err) 38%)",
  mcp: "var(--color-ok)",
  subagent: "var(--color-warn)",
  model: "var(--color-fg-dim)",
};
