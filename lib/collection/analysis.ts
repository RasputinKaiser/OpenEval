import { displayModelId } from "../pricing";
import { histogram, inRange, type ChartEvidence, type ChartSelection, type HistogramBin } from "../chart-analysis";
import type { MetricSource } from "../live";
import type { CollectedSession } from "./aggregate";

export interface AnalysisEvidence extends ChartEvidence {
  /** Snapshot metadata is kept beside the chart contract for stale states. */
  refreshing?: boolean;
  refreshError?: string;
}

export interface AnalysisGroup {
  key: string;
  label: string;
  count: number;
  sessions: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreateTokens: number | null;
  tokens: number | null;
  durationMs: number | null;
  costUsd: number | null;
  toolCalls: number | null;
  toolErrors: number | null;
}

/** Tool groups retain the established Collection byTool names as aliases. */
export interface AnalysisToolGroup extends AnalysisGroup {
  name: string;
  calls: number;
  errors: number;
}

export interface AnalysisOption {
  value: string;
  label: string;
  count: number;
}

export interface AnalysisUsageTotals {
  sessions: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreateTokens: number | null;
  tokens: number | null;
  durationMs: number | null;
  costUsd: number | null;
  measuredCostUsd: number | null;
  inferredCostUsd: number | null;
  toolCalls: number | null;
  toolErrors: number | null;
  tokenSessions: number;
  durationSessions: number;
  measuredCostSessions: number;
  inferredCostSessions: number;
}

export interface AnalysisTimeBucket {
  startMs: number;
  endMs: number;
  label: string;
  sessions: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreateTokens: number | null;
  tokens: number | null;
  durationMs: number | null;
  costUsd: number | null;
  toolCalls: number | null;
  toolErrors: number | null;
}

/** Redaction-safe evidence row. Do not add paths, titles, prompts, or projects. */
export interface AnalysisSessionEvidence {
  sourceId: string;
  sessionId: string;
  model: string;
  startedAt: number;
  durationMs: number | null;
  tokens: number | null;
  costUsd: number | null;
  costSource: MetricSource;
  toolCalls: number | null;
  toolErrors: number | null;
  archived: boolean;
  isSubagent: boolean;
}

export interface AnalysisReport {
  selection: ChartSelection;
  evidence: AnalysisEvidence;
  /** Full population before the current selection. */
  population: number;
  totalMatched: number;
  sourceGroups: AnalysisGroup[];
  modelGroups: AnalysisGroup[];
  toolGroups: AnalysisToolGroup[];
  usageTotals: AnalysisUsageTotals;
  timeBuckets: AnalysisTimeBucket[];
  tokenHistogram: { bins: HistogramBin[]; eligible: number; missing: number };
  durationHistogram: { bins: HistogramBin[]; eligible: number; missing: number };
  /** The route pages this array; all aggregates above use the full match set. */
  sessions: AnalysisSessionEvidence[];
  offset: number;
  limit: number;
  nextOffset: number | null;
  generation: number;
  options: {
    sources: AnalysisOption[];
    models: AnalysisOption[];
    tools: AnalysisOption[];
  };
}

export interface AnalysisSnapshotMeta {
  generatedAtMs: number;
  stale?: boolean;
  refreshing?: boolean;
  partial?: boolean;
  refreshError?: string;
}

const UNKNOWN_MODEL = "unknown";

export function canonicalModel(model: string | null | undefined): string {
  return displayModelId(model) ?? UNKNOWN_MODEL;
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function metricValue(session: CollectedSession, metric: "tokens" | "duration"): number | null {
  const source = session.metricSources[metric];
  if (source === "missing" || source === "malformed") return null;
  if (metric === "tokens") {
    return finiteNonNegative(session.totalTokens)
      ?? (finiteNonNegative(session.inputTokens) !== null && finiteNonNegative(session.outputTokens) !== null
        ? (session.inputTokens + session.outputTokens)
        : null);
  }
  return finiteNonNegative(session.durationMs);
}

function costValue(session: CollectedSession): number | null {
  const source = session.metricSources.cost;
  if (source === "missing" || source === "malformed") return null;
  const value = finiteNonNegative(session.costUsd);
  // An inferred zero is the parser's unavailable placeholder. A measured zero
  // is exact evidence and must remain a real zero.
  return source === "inferred" ? (value !== null && value > 0 ? value : null) : value;
}

function scalarValue(value: unknown): number | null {
  return finiteNonNegative(value);
}

function sumNullable(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) : null;
}

function sourceOptionKey(session: CollectedSession): string {
  return session.sourceId || "unknown";
}

function isChild(session: CollectedSession): boolean {
  return Boolean(session.isSubagent || session.parentSessionId);
}

/**
 * Apply only session-level collection predicates. Outcome provenance belongs
 * to Timeline, where current judgment receipts are available through toPoints.
 */
export function filterAnalysisSessions(
  sessions: readonly CollectedSession[],
  selection: ChartSelection,
): CollectedSession[] {
  return sessions.filter((session) => {
    if (selection.source !== undefined && session.sourceId !== selection.source) return false;
    if (selection.model !== undefined && canonicalModel(session.model) !== selection.model) return false;
    if (selection.fromMs !== undefined && session.startedAt < selection.fromMs) return false;
    if (selection.toMs !== undefined && session.startedAt >= selection.toMs) return false;
    if (selection.weekday !== undefined || selection.hour !== undefined) {
      if (!Number.isFinite(session.startedAt) || session.startedAt <= 0) return false;
      const date = new Date(session.startedAt);
      const weekday = (date.getDay() + 6) % 7;
      if (selection.weekday !== undefined && weekday !== selection.weekday) return false;
      if (selection.hour !== undefined && date.getHours() !== selection.hour) return false;
    }
    if (selection.tool !== undefined && !session.toolSummaries.some((tool) => tool.name === selection.tool)) return false;
    if (selection.costSource !== undefined && session.metricSources.cost !== selection.costSource) return false;
    if (selection.metric !== undefined && (selection.min !== undefined || selection.max !== undefined)) {
      const value = metricValue(session, selection.metric);
      if (value === null || !inRange(value, selection.min, selection.max)) return false;
    }
    return true;
  });
}

function buildOptions(sessions: readonly CollectedSession[]): AnalysisReport["options"] {
  const sources = new Map<string, { label: string; count: number }>();
  const models = new Map<string, number>();
  const tools = new Map<string, number>();
  for (const session of sessions) {
    const sourceKey = sourceOptionKey(session);
    const source = sources.get(sourceKey);
    if (source) source.count++;
    else sources.set(sourceKey, { label: session.sourceLabel || sourceKey, count: 1 });
    const modelKey = canonicalModel(session.model);
    models.set(modelKey, (models.get(modelKey) ?? 0) + 1);
    for (const tool of new Set(session.toolSummaries.map((item) => item.name).filter(Boolean))) {
      tools.set(tool, (tools.get(tool) ?? 0) + 1);
    }
  }
  return {
    sources: [...sources.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label) || a[0].localeCompare(b[0]))
      .map(([value, entry]) => ({ value, label: entry.label, count: entry.count })),
    models: [...models.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, label: value, count })),
    tools: [...tools.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, label: value, count })),
  };
}

interface GroupAccumulator {
  key: string;
  label: string;
  count: number;
  sessions: CollectedSession[];
  toolCalls?: number;
  toolErrors?: number;
}

function groupRows(groups: Map<string, GroupAccumulator>): AnalysisGroup[] {
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label) || a.key.localeCompare(b.key))
    .map((group) => {
      const rows = group.sessions;
      const inputTokens = rows.map((s) => s.metricSources.tokens === "missing" || s.metricSources.tokens === "malformed" ? null : scalarValue(s.inputTokens));
      const outputTokens = rows.map((s) => s.metricSources.tokens === "missing" || s.metricSources.tokens === "malformed" ? null : scalarValue(s.outputTokens));
      const cacheReadTokens = rows.map((s) => s.metricSources.tokens === "missing" || s.metricSources.tokens === "malformed" ? null : scalarValue(s.cacheReadTokens));
      const cacheCreateTokens = rows.map((s) => s.metricSources.tokens === "missing" || s.metricSources.tokens === "malformed" ? null : scalarValue(s.cacheCreateTokens));
      const tokenValues = rows.map((s) => metricValue(s, "tokens"));
      const durationValues = rows.map((s) => metricValue(s, "duration"));
      const costValues = rows.map(costValue);
      const calls = group.toolCalls === undefined ? rows.map((s) => scalarValue(s.toolCalls)) : [group.toolCalls];
      const errors = group.toolErrors === undefined ? rows.map((s) => scalarValue(s.toolErrors)) : [group.toolErrors];
      return {
        key: group.key,
        label: group.label,
        count: group.count,
        sessions: group.sessions.length,
        inputTokens: sumNullable(inputTokens),
        outputTokens: sumNullable(outputTokens),
        cacheReadTokens: sumNullable(cacheReadTokens),
        cacheCreateTokens: sumNullable(cacheCreateTokens),
        tokens: sumNullable(tokenValues),
        durationMs: sumNullable(durationValues),
        costUsd: sumNullable(costValues),
        toolCalls: sumNullable(calls),
        toolErrors: sumNullable(errors),
      };
    });
}

function buildGroups(sessions: readonly CollectedSession[]): { sources: AnalysisGroup[]; models: AnalysisGroup[]; tools: AnalysisToolGroup[] } {
  const sources = new Map<string, GroupAccumulator>();
  const models = new Map<string, GroupAccumulator>();
  const tools = new Map<string, GroupAccumulator>();
  for (const session of sessions) {
    const sourceKey = sourceOptionKey(session);
    const source = sources.get(sourceKey) ?? { key: sourceKey, label: session.sourceLabel || sourceKey, count: 0, sessions: [] };
    source.count++;
    source.sessions.push(session);
    sources.set(sourceKey, source);

    const modelKey = canonicalModel(session.model);
    const model = models.get(modelKey) ?? { key: modelKey, label: modelKey, count: 0, sessions: [] };
    model.count++;
    model.sessions.push(session);
    models.set(modelKey, model);

    for (const tool of session.toolSummaries) {
      if (!tool.name) continue;
      const group = tools.get(tool.name) ?? { key: tool.name, label: tool.name, count: 0, sessions: [], toolCalls: 0, toolErrors: 0 };
      group.count += scalarValue(tool.calls) ?? 0;
      group.toolCalls = (group.toolCalls ?? 0) + (scalarValue(tool.calls) ?? 0);
      group.toolErrors = (group.toolErrors ?? 0) + (scalarValue(tool.errors) ?? 0);
      group.sessions.push(session);
      tools.set(tool.name, group);
    }
  }
  const toolRows = groupRows(tools).map((group): AnalysisToolGroup => ({
    ...group,
    name: group.key,
    calls: group.toolCalls ?? 0,
    errors: group.toolErrors ?? 0,
  }));
  return { sources: groupRows(sources), models: groupRows(models), tools: toolRows };
}

function buildUsageTotals(sessions: readonly CollectedSession[]): AnalysisUsageTotals {
  const tokenValues = sessions.map((s) => metricValue(s, "tokens"));
  const durationValues = sessions.map((s) => metricValue(s, "duration"));
  const costs = sessions.map(costValue);
  const measuredCosts = sessions.map((s) => s.metricSources.cost === "measured" ? scalarValue(s.costUsd) : null);
  const inferredCosts = sessions.map((s) => s.metricSources.cost === "inferred" ? costValue(s) : null);
  const input = sessions.map((s) => s.metricSources.tokens === "missing" || s.metricSources.tokens === "malformed" ? null : scalarValue(s.inputTokens));
  const output = sessions.map((s) => s.metricSources.tokens === "missing" || s.metricSources.tokens === "malformed" ? null : scalarValue(s.outputTokens));
  const cacheRead = sessions.map((s) => s.metricSources.tokens === "missing" || s.metricSources.tokens === "malformed" ? null : scalarValue(s.cacheReadTokens));
  const cacheCreate = sessions.map((s) => s.metricSources.tokens === "missing" || s.metricSources.tokens === "malformed" ? null : scalarValue(s.cacheCreateTokens));
  return {
    sessions: sessions.length,
    inputTokens: sumNullable(input),
    outputTokens: sumNullable(output),
    cacheReadTokens: sumNullable(cacheRead),
    cacheCreateTokens: sumNullable(cacheCreate),
    tokens: sumNullable(tokenValues),
    durationMs: sumNullable(durationValues),
    costUsd: sumNullable(costs),
    measuredCostUsd: sumNullable(measuredCosts),
    inferredCostUsd: sumNullable(inferredCosts),
    toolCalls: sumNullable(sessions.map((s) => scalarValue(s.toolCalls))),
    toolErrors: sumNullable(sessions.map((s) => scalarValue(s.toolErrors))),
    tokenSessions: tokenValues.filter((value) => value !== null).length,
    durationSessions: durationValues.filter((value) => value !== null).length,
    measuredCostSessions: measuredCosts.filter((value) => value !== null).length,
    inferredCostSessions: inferredCosts.filter((value) => value !== null).length,
  };
}

function bucketMetrics(sessions: readonly CollectedSession[], startMs: number, endMs: number, label: string): AnalysisTimeBucket {
  const input = sessions.map((s) => s.metricSources.tokens === "missing" || s.metricSources.tokens === "malformed" ? null : scalarValue(s.inputTokens));
  const output = sessions.map((s) => s.metricSources.tokens === "missing" || s.metricSources.tokens === "malformed" ? null : scalarValue(s.outputTokens));
  const cacheRead = sessions.map((s) => s.metricSources.tokens === "missing" || s.metricSources.tokens === "malformed" ? null : scalarValue(s.cacheReadTokens));
  const cacheCreate = sessions.map((s) => s.metricSources.tokens === "missing" || s.metricSources.tokens === "malformed" ? null : scalarValue(s.cacheCreateTokens));
  return {
    startMs,
    endMs,
    label,
    sessions: sessions.length,
    inputTokens: sumNullable(input),
    outputTokens: sumNullable(output),
    cacheReadTokens: sumNullable(cacheRead),
    cacheCreateTokens: sumNullable(cacheCreate),
    tokens: sumNullable(sessions.map((s) => metricValue(s, "tokens"))),
    durationMs: sumNullable(sessions.map((s) => metricValue(s, "duration"))),
    costUsd: sumNullable(sessions.map(costValue)),
    toolCalls: sumNullable(sessions.map((s) => scalarValue(s.toolCalls))),
    toolErrors: sumNullable(sessions.map((s) => scalarValue(s.toolErrors))),
  };
}

function localDayStart(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function nextLocalDay(ms: number): number {
  const date = new Date(ms);
  date.setDate(date.getDate() + 1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function buildTimeBuckets(sessions: readonly CollectedSession[]): AnalysisTimeBucket[] {
  const valid = sessions.filter((s) => Number.isFinite(s.startedAt) && s.startedAt > 0);
  if (!valid.length) return [];
  const days = [...new Set(valid.map((s) => localDayStart(s.startedAt)))].sort((a, b) => a - b);
  if (days.length <= 90) {
    return days.map((start) => bucketMetrics(
      valid.filter((session) => localDayStart(session.startedAt) === start),
      start,
      nextLocalDay(start),
      new Date(start).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    ));
  }
  const min = Math.min(...valid.map((s) => s.startedAt));
  const max = Math.max(...valid.map((s) => s.startedAt));
  const span = Math.max(1, max - min + 1);
  return Array.from({ length: 90 }, (_, index) => {
    const start = min + Math.floor((span * index) / 90);
    const end = index === 89 ? max + 1 : min + Math.floor((span * (index + 1)) / 90);
    return bucketMetrics(
      valid.filter((session) => session.startedAt >= start && session.startedAt < end),
      start,
      end,
      `${new Date(start).toLocaleDateString(undefined, { month: "short", day: "numeric" })}–${new Date(Math.max(start, end - 1)).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
    );
  }).filter((bucket) => bucket.sessions > 0);
}

function toEvidenceRow(session: CollectedSession): AnalysisSessionEvidence {
  return {
    sourceId: session.sourceId,
    sessionId: session.sessionId,
    model: canonicalModel(session.model),
    startedAt: session.startedAt,
    durationMs: metricValue(session, "duration"),
    tokens: metricValue(session, "tokens"),
    costUsd: costValue(session),
    costSource: session.metricSources.cost,
    toolCalls: scalarValue(session.toolCalls),
    toolErrors: scalarValue(session.toolErrors),
    archived: Boolean(session.archived),
    isSubagent: isChild(session),
  };
}

export function buildAnalysisReport(
  population: readonly CollectedSession[],
  matched: readonly CollectedSession[],
  selection: ChartSelection,
  meta: AnalysisSnapshotMeta,
  page: { offset?: number; limit?: number } = {},
): AnalysisReport {
  const tokenValues = matched.map((session) => metricValue(session, "tokens") ?? Number.NaN);
  const durationValues = matched.map((session) => metricValue(session, "duration") ?? Number.NaN);
  const partial = Boolean(meta.partial);
  const evidence: AnalysisEvidence = {
    population: population.length,
    eligible: matched.length,
    plotted: matched.length,
    scope: "parsed snapshot",
    provenance: "collection snapshot",
    generatedAtMs: meta.generatedAtMs,
    stale: Boolean(meta.stale),
    partial,
    ...(meta.refreshing === undefined ? {} : { refreshing: meta.refreshing }),
    ...(meta.refreshError ? { refreshError: meta.refreshError } : {}),
  };
  const groups = buildGroups(matched);
  const offset = Math.max(0, Math.floor(page.offset ?? 0));
  const limit = Math.max(1, Math.floor(page.limit ?? (matched.length || 1)));
  const allRows = matched
    .slice()
    .sort((a, b) => b.startedAt - a.startedAt || a.sourceId.localeCompare(b.sourceId) || a.sessionId.localeCompare(b.sessionId))
    .map(toEvidenceRow);
  return {
    selection,
    evidence,
    population: population.length,
    totalMatched: matched.length,
    sourceGroups: groups.sources,
    modelGroups: groups.models,
    toolGroups: groups.tools,
    usageTotals: buildUsageTotals(matched),
    timeBuckets: buildTimeBuckets(matched),
    tokenHistogram: histogram(tokenValues, "tokens"),
    durationHistogram: histogram(durationValues, "duration"),
    // Keep list ordering aligned with the legacy Collection view: newest first,
    // source-qualified identity as the stable tie-breaker.
    sessions: allRows.slice(offset, offset + limit),
    offset,
    limit,
    nextOffset: offset + limit < allRows.length ? offset + limit : null,
    generation: meta.generatedAtMs,
    options: buildOptions(population),
  };
}

export function isUnsupportedCollectionSelection(selection: ChartSelection): string | null {
  return selection.outcome === undefined
    ? null
    : "Outcome provenance filtering is only available on the Timeline report.";
}
