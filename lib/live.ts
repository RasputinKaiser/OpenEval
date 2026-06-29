import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { compactDisplayPath, redactSensitiveText } from "./redaction";

export type MetricSource = "measured" | "inferred" | "missing" | "malformed";

export interface LiveMetricSources {
  model: MetricSource;
  tokens: MetricSource;
  cost: MetricSource;
  duration: MetricSource;
  turns: MetricSource;
}

export interface LiveSession {
  sessionId: string;
  project: string;
  model: string | null;
  startedAt: number;
  lastEventAt: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  toolCalls: number;
  toolErrors: number;
  numTurns: number;
  stopReason: string | null;
  isError: boolean;
  pathBytes: number;
  lineCount: number;
  malformedLineCount: number;
  thinkingBlocks: number;
  textBlocks: number;
  attachmentCount: number;
  queueOperationCount: number;
  snapshotCount: number;
  hookErrors: number;
  messageCount: number;
  userType: string | null;
  dataQuality: number;
  metricSources: LiveMetricSources;
  parseWarnings: string[];
  toolErrorRate: number;
  toolCallsPerTurn: number;
  textAvailability: number;
  staleMs: number;
  path?: string;
}

export interface LiveAggregate {
  totalSessions: number;
  totalProjects: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalToolCalls: number;
  totalToolErrors: number;
  sessionsWithMeasuredDuration: number;
  sessionsWithMissingModel: number;
  sessionsWithInferredModel: number;
  sessionsWithMissingTokens: number;
  sessionsWithMalformedLines: number;
  staleSessions: number;
  avgDataQuality: number;
  scanWarnings: string[];
  byModel: Array<{
    model: string;
    sessions: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    toolCalls: number;
    errors: number;
    avgDurationMs: number;
    avgDataQuality: number;
    missingTokens: number;
    missingCost: number;
  }>;
  sessions: LiveSession[];
}

export interface LiveTranscriptTurn {
  type: string;
  subtype?: string;
  severity: "info" | "warning" | "error";
  at?: number;
  label: string;
  preview: string;
}

export interface TranscriptResult {
  turns: LiveTranscriptTurn[];
  error?: string;
}

export { compactDisplayPath, redactSensitiveText };

const NOUMENA_CODE_INFERRED_MODEL = "GLM 5.2 (1M)";

export function ncodeProjectsDir(): string {
  return path.join(os.homedir(), ".ncode", "projects");
}

function decodeProjectDir(name: string): string {
  return name
    .replace(/^-/, "/")
    .replace(/--/g, "/.")
    .replace(/-/g, "/");
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function jsonPreview(value: unknown, max = 420): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function metricMissing(source: MetricSource): boolean {
  return source === "missing" || source === "malformed";
}

function isNoumenaCodeTrace(userType: string | null, project: string, file: string): boolean {
  const normalizedUserType = userType?.toLowerCase();
  return normalizedUserType === "noumena" || project.includes("/.ncode") || file.includes(`${path.sep}.ncode${path.sep}projects${path.sep}`);
}

export function scanLiveSessions(limit = 200): LiveAggregate {
  const dir = ncodeProjectsDir();
  const sessions: LiveSession[] = [];
  const scanWarnings: string[] = [];

  let projectDirs: string[] = [];
  try {
    projectDirs = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch (e) {
    scanWarnings.push(`Could not read ${dir}: ${e instanceof Error ? e.message : String(e)}`);
    return aggregate(sessions, scanWarnings);
  }

  const files: Array<{ file: string; project: string; mtime: number }> = [];
  for (const pd of projectDirs) {
    const pdir = path.join(dir, pd);
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(pdir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isFile() || !ent.name.endsWith(".jsonl")) continue;
      const full = path.join(pdir, ent.name);
      try {
        const st = fs.statSync(full);
        files.push({ file: full, project: pd, mtime: st.mtimeMs });
      } catch {
        continue;
      }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);

  for (const f of files.slice(0, limit)) {
    const s = summarizeLiveSessionFile(f.file, f.project, f.mtime);
    if (s) sessions.push(s);
  }

  return aggregate(sessions, scanWarnings);
}

export function parseSessionTranscript(filePath: string): TranscriptResult {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const turns: LiveTranscriptTurn[] = [];
    let index = 0;
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      index++;
      try {
        turns.push(toTranscriptTurn(JSON.parse(line), index));
      } catch {
        turns.push({
          type: "malformed",
          severity: "warning",
          label: `Malformed line ${index}`,
          preview: line.slice(0, 420),
        });
      }
    }
    return { turns };
  } catch (e) {
    return { turns: [], error: e instanceof Error ? e.message : String(e) };
  }
}

function isErroringTurn(turn: LiveTranscriptTurn): boolean {
  return turn.severity === "error" || turn.severity === "warning";
}

export function getErroringTurns(filePath: string): TranscriptResult {
  const parsed = parseSessionTranscript(filePath);
  if (parsed.error) return { turns: [], error: parsed.error };
  const keep = new Set<number>();
  parsed.turns.forEach((turn, index) => {
    if (!isErroringTurn(turn)) return;
    keep.add(Math.max(0, index - 1));
    keep.add(index);
    keep.add(Math.min(parsed.turns.length - 1, index + 1));
  });
  return { turns: [...keep].sort((a, b) => a - b).map((index) => parsed.turns[index]) };
}

export function summarizeLiveSessionFile(file: string, projectDir: string, mtime: number): LiveSession | null {
  let model: string | null = null;
  let sessionId: string | null = null;
  let project = decodeProjectDir(projectDir);
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let costUsd = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let numTurns = 0;
  let durationMs = 0;
  let stopReason: string | null = null;
  let isError = false;
  let startedAt = mtime;
  let lastEventAt = mtime;
  let pathBytes = 0;
  let lineCount = 0;
  let malformedLineCount = 0;
  let thinkingBlocks = 0;
  let textBlocks = 0;
  let attachmentCount = 0;
  let queueOperationCount = 0;
  let snapshotCount = 0;
  let hookErrors = 0;
  let messageCount = 0;
  let userType: string | null = null;
  let sawResult = false;

  const metricSources: LiveMetricSources = {
    model: "missing",
    tokens: "missing",
    cost: "missing",
    duration: "missing",
    turns: "missing",
  };

  try {
    const content = fs.readFileSync(file, "utf8");
    pathBytes = Buffer.byteLength(content);
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      lineCount++;
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        malformedLineCount++;
        continue;
      }

      const at = parseTimestamp(obj.timestamp) ?? parseTimestamp(obj.created_at) ?? null;
      if (at) {
        startedAt = Math.min(startedAt, at);
        lastEventAt = Math.max(lastEventAt, at);
      }

      if (obj.type === "system") {
        model = obj.model ?? model;
        sessionId = obj.sessionId ?? obj.session_id ?? sessionId;
        project = obj.cwd ?? obj.project ?? project;
        userType = obj.userType ?? userType;
        stopReason = obj.stopReason ?? stopReason;
        hookErrors += Number(obj.hookErrors ?? 0) || 0;
        messageCount = Math.max(messageCount, Number(obj.messageCount ?? 0) || 0);
        if (typeof obj.durationMs === "number") {
          durationMs = Math.max(durationMs, obj.durationMs);
          metricSources.duration = "measured";
        }
        if (typeof obj.totalDurationMs === "number") {
          durationMs = Math.max(durationMs, obj.totalDurationMs);
          metricSources.duration = "measured";
        }
      } else if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
        for (const b of obj.message.content) {
          if (b.type === "tool_use") toolCalls++;
          if (b.type === "thinking") thinkingBlocks++;
          if (b.type === "text") textBlocks++;
        }
      } else if (obj.type === "user" && Array.isArray(obj.message?.content)) {
        for (const b of obj.message.content) {
          if (b.type === "tool_result" && b.is_error) toolErrors++;
        }
      } else if (obj.type === "attachment") {
        attachmentCount++;
      } else if (obj.type === "queue-operation") {
        queueOperationCount++;
      } else if (obj.type === "file-history-snapshot") {
        snapshotCount++;
      } else if (obj.type === "result") {
        sawResult = true;
        const usage = obj.usage || {};
        inputTokens = usage.input_tokens ?? inputTokens;
        outputTokens = usage.output_tokens ?? outputTokens;
        cacheReadTokens = usage.cache_read_input_tokens ?? cacheReadTokens;
        costUsd = obj.total_cost_usd ?? costUsd;
        durationMs = obj.duration_ms ?? durationMs;
        numTurns = obj.num_turns ?? numTurns;
        stopReason = obj.stop_reason ?? stopReason;
        isError = !!obj.is_error;
        sessionId = obj.session_id ?? sessionId;
        if (usage.input_tokens != null || usage.output_tokens != null || usage.cache_read_input_tokens != null) metricSources.tokens = "measured";
        if (obj.total_cost_usd != null) metricSources.cost = "measured";
        if (obj.duration_ms != null) metricSources.duration = "measured";
        if (obj.num_turns != null) metricSources.turns = "measured";
      }
    }
  } catch {
    return null;
  }

  if (model) {
    metricSources.model = "measured";
  } else if (isNoumenaCodeTrace(userType, project, file)) {
    model = NOUMENA_CODE_INFERRED_MODEL;
    metricSources.model = "inferred";
  }
  if (numTurns === 0 && messageCount > 0) {
    numTurns = messageCount;
    metricSources.turns = "inferred";
  } else if (numTurns > 0 && metricSources.turns === "missing") {
    metricSources.turns = sawResult ? "measured" : "inferred";
  }
  if (malformedLineCount > 0 && lineCount === malformedLineCount) {
    metricSources.model = "malformed";
    metricSources.tokens = "malformed";
    metricSources.cost = "malformed";
    metricSources.duration = "malformed";
    metricSources.turns = "malformed";
  }

  const parseWarnings = buildWarnings(metricSources, malformedLineCount, lineCount, hookErrors, sawResult);
  const toolErrorRate = toolCalls > 0 ? toolErrors / toolCalls : 0;
  const toolCallsPerTurn = numTurns > 0 ? toolCalls / numTurns : 0;
  const textAvailability = lineCount > 0 ? textBlocks / lineCount : 0;
  const staleMs = Math.max(0, Date.now() - lastEventAt);

  return {
    sessionId: sessionId ?? path.basename(file, ".jsonl"),
    project,
    model,
    startedAt,
    lastEventAt,
    durationMs,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    costUsd,
    toolCalls,
    toolErrors,
    numTurns,
    stopReason,
    isError,
    pathBytes,
    path: file,
    lineCount,
    malformedLineCount,
    thinkingBlocks,
    textBlocks,
    attachmentCount,
    queueOperationCount,
    snapshotCount,
    hookErrors,
    messageCount,
    userType,
    dataQuality: scoreQuality(metricSources, malformedLineCount, lineCount, hookErrors, toolErrorRate),
    metricSources,
    parseWarnings,
    toolErrorRate,
    toolCallsPerTurn,
    textAvailability,
    staleMs,
  };
}

function buildWarnings(sources: LiveMetricSources, malformedLineCount: number, lineCount: number, hookErrors: number, sawResult: boolean): string[] {
  const warnings: string[] = [];
  if (sources.model === "missing") warnings.push("model missing from trace");
  if (sources.model === "inferred") warnings.push(`model inferred as ${NOUMENA_CODE_INFERRED_MODEL} from Noumena Code/ncode default`);
  if (sources.tokens === "missing") warnings.push("token usage missing from trace");
  if (sources.cost === "missing") warnings.push("cost missing from trace");
  if (sources.duration === "missing") warnings.push("duration missing from trace");
  if (sources.turns === "inferred") warnings.push("turn count inferred from messageCount");
  if (!sawResult) warnings.push("no final result event found");
  if (malformedLineCount > 0) warnings.push(`${malformedLineCount}/${lineCount} malformed line(s) skipped`);
  if (hookErrors > 0) warnings.push(`${hookErrors} hook error(s) reported`);
  return warnings;
}

function scoreQuality(sources: LiveMetricSources, malformedLineCount: number, lineCount: number, hookErrors: number, toolErrorRate: number): number {
  let score = 100;
  if (metricMissing(sources.model)) score -= 12;
  if (metricMissing(sources.tokens)) score -= 14;
  if (metricMissing(sources.cost)) score -= 8;
  if (metricMissing(sources.duration)) score -= 12;
  if (sources.turns === "missing") score -= 8;
  if (sources.turns === "inferred") score -= 3;
  if (malformedLineCount > 0) score -= Math.min(20, Math.ceil((malformedLineCount / Math.max(lineCount, 1)) * 100));
  if (hookErrors > 0) score -= Math.min(12, hookErrors * 2);
  if (toolErrorRate > 0.25) score -= 6;
  return Math.max(0, Math.min(100, score));
}

function toTranscriptTurn(obj: any, index: number): LiveTranscriptTurn {
  const type = typeof obj?.type === "string" ? obj.type : "unknown";
  const subtype = typeof obj?.subtype === "string" ? obj.subtype : undefined;
  const at = parseTimestamp(obj?.timestamp) ?? undefined;

  if (type === "system") {
    const warnings = Number(obj.hookErrors ?? 0) || 0;
    return {
      type,
      subtype,
      severity: warnings > 0 ? "warning" : "info",
      at,
      label: subtype ? `System / ${subtype}` : "System event",
      preview: jsonPreview({ cwd: obj.cwd, sessionId: obj.sessionId ?? obj.session_id, stopReason: obj.stopReason, hookErrors: obj.hookErrors, messageCount: obj.messageCount }),
    };
  }

  if (type === "assistant" && Array.isArray(obj.message?.content)) {
    const tools = obj.message.content.filter((b: any) => b.type === "tool_use").map((b: any) => b.name).filter(Boolean);
    const text = obj.message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ");
    const thinkingCount = obj.message.content.filter((b: any) => b.type === "thinking").length;
    return {
      type,
      subtype,
      severity: "info",
      at,
      label: tools.length ? `Assistant tool use: ${tools.join(", ")}` : thinkingCount ? "Assistant thinking" : "Assistant text",
      preview: jsonPreview(text || { tools, thinkingBlocks: thinkingCount }),
    };
  }

  if (type === "user" && Array.isArray(obj.message?.content)) {
    const errored = obj.message.content.some((b: any) => b.type === "tool_result" && b.is_error);
    return {
      type,
      subtype,
      severity: errored ? "error" : "info",
      at,
      label: errored ? "Tool result error" : "Tool/user result",
      preview: jsonPreview(obj.message.content),
    };
  }

  if (type === "result") {
    return {
      type,
      subtype,
      severity: obj.is_error ? "error" : "info",
      at,
      label: obj.is_error ? "Final result error" : "Final result",
      preview: jsonPreview({ stopReason: obj.stop_reason, durationMs: obj.duration_ms, numTurns: obj.num_turns, usage: obj.usage, costUsd: obj.total_cost_usd }),
    };
  }

  return {
    type,
    subtype,
    severity: type === "queue-operation" ? "warning" : "info",
    at,
    label: `${type || "Trace"} event ${index}`,
    preview: jsonPreview(obj),
  };
}

function aggregate(sessions: LiveSession[], scanWarnings: string[] = []): LiveAggregate {
  const byModelMap = new Map<string, {
    model: string;
    sessions: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    toolCalls: number;
    errors: number;
    totalDur: number;
    totalQuality: number;
    missingTokens: number;
    missingCost: number;
  }>();
  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalToolCalls = 0;
  let totalToolErrors = 0;
  let totalQuality = 0;
  const projects = new Set<string>();

  for (const s of sessions) {
    projects.add(s.project);
    totalCostUsd += s.costUsd;
    totalInputTokens += s.inputTokens;
    totalOutputTokens += s.outputTokens;
    totalToolCalls += s.toolCalls;
    totalToolErrors += s.toolErrors;
    totalQuality += s.dataQuality;
    const key = s.model || "unknown";
    const cur = byModelMap.get(key) || { model: key, sessions: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, toolCalls: 0, errors: 0, totalDur: 0, totalQuality: 0, missingTokens: 0, missingCost: 0 };
    cur.sessions++;
    cur.costUsd += s.costUsd;
    cur.inputTokens += s.inputTokens;
    cur.outputTokens += s.outputTokens;
    cur.toolCalls += s.toolCalls;
    cur.errors += s.toolErrors;
    cur.totalDur += s.durationMs;
    cur.totalQuality += s.dataQuality;
    if (s.metricSources.tokens === "missing") cur.missingTokens++;
    if (s.metricSources.cost === "missing") cur.missingCost++;
    byModelMap.set(key, cur);
  }

  const byModel = Array.from(byModelMap.values()).map((m) => ({
    model: m.model,
    sessions: m.sessions,
    costUsd: m.costUsd,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    toolCalls: m.toolCalls,
    errors: m.errors,
    avgDurationMs: m.sessions ? m.totalDur / m.sessions : 0,
    avgDataQuality: m.sessions ? m.totalQuality / m.sessions : 0,
    missingTokens: m.missingTokens,
    missingCost: m.missingCost,
  })).sort((a, b) => b.errors - a.errors || a.avgDataQuality - b.avgDataQuality);

  return {
    totalSessions: sessions.length,
    totalProjects: projects.size,
    totalCostUsd,
    totalInputTokens,
    totalOutputTokens,
    totalToolCalls,
    totalToolErrors,
    sessionsWithMeasuredDuration: sessions.filter((s) => s.metricSources.duration === "measured").length,
    sessionsWithMissingModel: sessions.filter((s) => s.metricSources.model === "missing").length,
    sessionsWithInferredModel: sessions.filter((s) => s.metricSources.model === "inferred").length,
    sessionsWithMissingTokens: sessions.filter((s) => s.metricSources.tokens === "missing").length,
    sessionsWithMalformedLines: sessions.filter((s) => s.malformedLineCount > 0).length,
    staleSessions: sessions.filter((s) => s.staleMs > 1000 * 60 * 60 * 12).length,
    avgDataQuality: sessions.length ? totalQuality / sessions.length : 0,
    scanWarnings,
    byModel,
    sessions: sessions.slice(0, 100),
  };
}
