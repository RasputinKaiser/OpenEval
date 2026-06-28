import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface LiveSession {
  sessionId: string;
  project: string;
  model: string | null;
  startedAt: number;
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
  byModel: Array<{ model: string; sessions: number; costUsd: number; inputTokens: number; outputTokens: number; toolCalls: number; errors: number; avgDurationMs: number }>;
  sessions: LiveSession[];
}

export function ncodeProjectsDir(): string {
  return path.join(os.homedir(), ".ncode", "projects");
}

function decodeProjectDir(name: string): string {
  return name.replace(/^-/, "/").replace(/-/g, "/");
}

export function scanLiveSessions(limit = 200): LiveAggregate {
  const dir = ncodeProjectsDir();
  const sessions: LiveSession[] = [];

  let projectDirs: string[] = [];
  projectDirs = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

  const files: Array<{ file: string; project: string; mtime: number }> = [];
  for (const pd of projectDirs) {
    const pdir = path.join(dir, pd);
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(pdir, { withFileTypes: true }); } catch { continue; }
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
  const recent = files.slice(0, limit);

  for (const f of recent) {
    const s = summarizeSessionFile(f.file, f.project, f.mtime);
    if (s) sessions.push(s);
  }

  return aggregate(sessions);
}

export interface TranscriptResult {
  turns: unknown[];
  error?: string;
}

export function parseSessionTranscript(filePath: string): TranscriptResult {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const turns: unknown[] = [];
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        turns.push(JSON.parse(line));
      } catch {
        // skip malformed lines
      }
    }
    return { turns };
  } catch (e) {
    return { turns: [], error: e instanceof Error ? e.message : String(e) };
  }
}

function isErroringTurn(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  if (o.is_error) return true;
  if (o.type === "result" && o.is_error) return true;
  if (o.type === "user" && o.message && typeof o.message === "object" && Array.isArray((o.message as Record<string, unknown>).content)) {
    for (const b of (o.message as Record<string, unknown>).content as unknown[]) {
      if (b && typeof b === "object" && (b as Record<string, unknown>).type === "tool_result" && (b as Record<string, unknown>).is_error) {
        return true;
      }
    }
  }
  return false;
}

export function getErroringTurns(filePath: string): TranscriptResult {
  const parsed = parseSessionTranscript(filePath);
  if (parsed.error) return { turns: [], error: parsed.error };
  return { turns: parsed.turns.filter(isErroringTurn) };
}

function summarizeSessionFile(file: string, projectDir: string, mtime: number): LiveSession | null {
  let model: string | null = null;
  let sessionId: string | null = null;
  let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, costUsd = 0;
  let toolCalls = 0, toolErrors = 0, numTurns = 0;
  let durationMs = 0, stopReason: string | null = null;
  let isError = false;
  let startedAt = mtime;
  let pathBytes = 0;

  try {
    const content = fs.readFileSync(file, "utf8");
    pathBytes = Buffer.byteLength(content);
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      let obj: any;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj.type === "system" && obj.subtype === "init") {
        model = obj.model ?? model;
        sessionId = obj.session_id ?? sessionId;
      } else if (obj.type === "assistant" && obj.message?.content) {
        for (const b of obj.message.content) {
          if (b.type === "tool_use") {
            toolCalls++;
          }
        }
      } else if (obj.type === "user" && Array.isArray(obj.message?.content)) {
        for (const b of obj.message.content) {
          if (b.type === "tool_result" && b.is_error) toolErrors++;
        }
      } else if (obj.type === "result") {
        const u = obj.usage || {};
        inputTokens = u.input_tokens ?? inputTokens;
        outputTokens = u.output_tokens ?? outputTokens;
        cacheReadTokens = u.cache_read_input_tokens ?? cacheReadTokens;
        costUsd = obj.total_cost_usd ?? costUsd;
        durationMs = obj.duration_ms ?? durationMs;
        numTurns = obj.num_turns ?? numTurns;
        stopReason = obj.stop_reason ?? stopReason;
        isError = !!obj.is_error;
        if (obj.session_id) sessionId = obj.session_id;
      }
    }
  } catch { return null; }

  return {
    sessionId: sessionId ?? path.basename(file, ".jsonl"),
    project: decodeProjectDir(projectDir),
    model,
    startedAt,
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
  };
}

function aggregate(sessions: LiveSession[]): LiveAggregate {
  const byModelMap = new Map<string, { model: string; sessions: number; costUsd: number; inputTokens: number; outputTokens: number; toolCalls: number; errors: number; totalDur: number }>();
  let totalCostUsd = 0, totalInputTokens = 0, totalOutputTokens = 0, totalToolCalls = 0, totalToolErrors = 0;
  const projects = new Set<string>();

  for (const s of sessions) {
    projects.add(s.project);
    totalCostUsd += s.costUsd;
    totalInputTokens += s.inputTokens;
    totalOutputTokens += s.outputTokens;
    totalToolCalls += s.toolCalls;
    totalToolErrors += s.toolErrors;
    const key = s.model || "unknown";
    const cur = byModelMap.get(key) || { model: key, sessions: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, toolCalls: 0, errors: 0, totalDur: 0 };
    cur.sessions++; cur.costUsd += s.costUsd; cur.inputTokens += s.inputTokens; cur.outputTokens += s.outputTokens;
    cur.toolCalls += s.toolCalls; cur.errors += s.toolErrors; cur.totalDur += s.durationMs;
    byModelMap.set(key, cur);
  }

  const byModel = Array.from(byModelMap.values()).map((m) => ({
    ...m, avgDurationMs: m.sessions ? m.totalDur / m.sessions : 0,
  })).sort((a, b) => b.costUsd - a.costUsd);

  return {
    totalSessions: sessions.length,
    totalProjects: projects.size,
    totalCostUsd,
    totalInputTokens,
    totalOutputTokens,
    totalToolCalls,
    totalToolErrors,
    byModel,
    sessions: sessions.slice(0, 100),
  };
}
