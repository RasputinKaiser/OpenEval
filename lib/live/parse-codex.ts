import path from "node:path";
import { classifySentiment, isRephraseTracked, looksLikeApologyOrFailure, looksLikeTestsPassed, JUDGE_PROMPT_MARKER } from "../insights/signals";
import { estimateCostUsd } from "../pricing";
import type { LiveMetricSources, LiveModelUsage, LiveSession, LiveUsageSegment } from "./types";
import { NON_WS_RE, buildWarnings, coalesceModel, codexToolOutputError, downsampleUsageSegments, ensureModelUsage, estimateModelUsageCost, extractFilePaths, increment, jsonPreview, modelUsageVolume, parseTimestamp, scoreQuality, summarizeToolDurations, topEntries } from "./util";

const ORCHESTRATION_MARKERS = /\b(team of agents|coordinator|orchestrat\w*|primary agent|worker \d|subagent|multi-agent)\b/i;

/**
 * Orchestrator-injected preambles are plumbing, not the user's ask — using
 * them as titles/prompt previews leaks system-prompt text all over list UIs.
 * Subagent sessions are flagged deterministically by
 * session_meta.source.subagent, so any "You are …" there is injected. Root
 * coordinator sessions carry NO metadata flag (source is just "vscode"), so
 * they fall back to orchestration vocabulary — which a human's own persona
 * prompt ("You are too verbose, rewrite …") won't contain. AGENTS.md
 * injection happens in normal sessions too and stays a plain text check.
 */
function isInjectedPreamble(text: string, subagentSession: boolean): boolean {
  const t = text.trimStart();
  if (t.startsWith("# AGENTS.md instructions")) return true;
  if (!/^You are\b/.test(t)) return false;
  if (subagentSession) return true;
  return t.length > 120 && ORCHESTRATION_MARKERS.test(t);
}

/**
 * IDE-launched Codex sessions wrap the user's prompt in an editor-context
 * preamble; the actual ask follows the "## My request for Codex:" header
 * (shape verified against real rollouts). Return the ask, or the text
 * unchanged when unwrapped.
 */
export function stripIdeContextWrapper(text: string): string {
  if (!text.startsWith("# Context from my IDE setup")) return text;
  const marker = "## My request for Codex:";
  const idx = text.indexOf(marker);
  return idx >= 0 ? text.slice(idx + marker.length) : text;
}

export function parseCodexSession(file: string, lines: Iterable<string>, bytes: number, projectDir: string, mtime: number): LiveSession | null {
  let sessionId: string | null = null;
  let displayTitle: string | null = null;
  let lastPromptPreview: string | null = null;
  let isSubagent = false;
  let project = projectDir;
  let model: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreateTokens = 0;
  // Codex token accounting: sum per-turn usage (billed), not max-of-cumulative
  // (which undercounts sessions whose context was compacted/reset).
  let sumIn = 0, sumOut = 0, sumCached = 0;
  let userPositive = 0, userNegative = 0, rephrases = 0;
  let lastUserText: string | null = null;
  // Carries lastUserText's token set between isRephraseTracked calls; must
  // only be touched by that call, in lockstep with lastUserText assignments.
  const rephraseCache: { tokens: Set<string> | null } = { tokens: null };
  let lastAgentText = "";
  let toolCalls = 0;
  let toolErrors = 0;
  let messageCount = 0;
  let turnContextCount = 0;
  let eventUserMessageCount = 0;
  let responseUserMessageCount = 0;
  let textBlocks = 0;
  let thinkingBlocks = 0;
  let startedAt = mtime;
  let lastEventAt = mtime;
  let pathBytes = 0;
  let lineCount = 0;
  let malformedLineCount = 0;
  let sawSessionMeta = false;
  let originator: string | null = null;
  let source: string | null = null;
  let cliVersion: string | null = null;
  const toolCallsByName = new Map<string, number>();
  const toolErrorsByName = new Map<string, number>();
  const toolStartByCallIdMs = new Map<string, number>();
  const toolNameByCallIdMs = new Map<string, string>();
  const toolModelByCallId = new Map<string, string>();
  const toolDurationMs = new Map<string, number[]>();
  const modelUsageByModel = new Map<string, LiveModelUsage>();
  const touchedFiles = new Set<string>();
  const usageSegments: LiveUsageSegment[] = [];
  const metricSources: LiveMetricSources = {
    model: "missing",
    tokens: "missing",
    cost: "missing",
    duration: "inferred",
    turns: "inferred",
  };

  const recordCodexUserText = (raw: string): "judge" | "recorded" | "ignored" => {
    const trimmed = stripIdeContextWrapper(raw).trim();
    if (trimmed.startsWith(JUDGE_PROMPT_MARKER)) return "judge";
    if (!trimmed || trimmed.startsWith("<") || isInjectedPreamble(trimmed, isSubagent)) return "ignored";
    lastPromptPreview = jsonPreview(trimmed, 260);
    displayTitle = displayTitle ?? jsonPreview(trimmed, 80);
    if (trimmed.length <= 600) {
      const sent = classifySentiment(trimmed);
      if (sent === "positive") userPositive++;
      else if (sent === "negative") userNegative++;
      if (isRephraseTracked(trimmed, lastUserText, rephraseCache)) rephrases++;
      lastUserText = trimmed;
    }
    return "recorded";
  };

  try {
    pathBytes = bytes;
    let previousTotalInput = 0;
    let previousTotalOutput = 0;
    let previousTotalCached = 0;
    let segmentInput = 0;
    let segmentOutput = 0;
    for (const line of lines) {
      if (!NON_WS_RE.test(line)) continue;
      lineCount++;
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        malformedLineCount++;
        continue;
      }

      const at = parseTimestamp(obj.timestamp) ?? parseTimestamp(obj.payload?.timestamp) ?? null;
      if (at) {
        startedAt = Math.min(startedAt, at);
        lastEventAt = Math.max(lastEventAt, at);
      }

      if (obj.type === "session_meta") {
        const payload = obj.payload ?? {};
        // Forked/subagent rollouts can embed one or more parent session_meta
        // records after their own root record. The first record identifies the
        // file; later records describe inherited context and must not replace
        // the child session id/source (which also caused duplicate React keys).
        if (!sawSessionMeta) {
          sawSessionMeta = true;
          sessionId = payload.id ?? payload.session_id ?? sessionId;
          project = payload.cwd ?? project;
          originator = payload.originator ?? originator;
          source = typeof payload.source === "string"
            ? payload.source
            : typeof payload.thread_source === "string"
              ? payload.thread_source
              : payload.source?.subagent
                ? "subagent"
                : source;
          if (payload.source?.subagent || payload.thread_source === "subagent") isSubagent = true;
          cliVersion = payload.cli_version ?? cliVersion;
          const recordedModel = coalesceModel(payload.model, payload.model_slug);
          if (recordedModel) {
            model = recordedModel;
            metricSources.model = "measured";
          }
          displayTitle = displayTitle ?? payload.thread_name ?? null;
        }
      } else if (obj.type === "turn_context") {
        turnContextCount++;
        const payload = obj.payload ?? {};
        project = payload.cwd ?? project;
        displayTitle = displayTitle ?? payload.thread_name ?? payload.title ?? null;
        // Codex records the model per turn here, not in session_meta — reading
        // only session_meta left every Codex session's model "unknown".
        const recordedModel = coalesceModel(payload.model, payload.model_slug);
        if (recordedModel) {
          model = recordedModel;
          metricSources.model = "measured";
        }
      } else if (obj.type === "event_msg") {
        const payload = obj.payload ?? {};
        if (payload.type === "agent_message" && typeof payload.message === "string") {
          textBlocks++;
          messageCount++;
          displayTitle = displayTitle ?? jsonPreview(payload.message, 80);
          lastAgentText = payload.message;
        } else if (payload.type === "user_message" && typeof payload.message === "string") {
          // Real rollouts carry user text HERE (event_msg/user_message), never
          // as a top-level user_msg record — this branch feeds the preview,
          // title fallback, and sentiment/rephrase signals for Codex sessions.
          const recorded = recordCodexUserText(payload.message);
          if (recorded === "judge") return null;
          if (recorded === "recorded") eventUserMessageCount++;
        } else if (payload.type === "token_count") {
          const info = payload.info ?? {};
          const last = info.last_token_usage;
          const tot = info.total_token_usage;
          let fallbackInputDelta = 0;
          let fallbackOutputDelta = 0;
          let fallbackCachedDelta = 0;
          if (last) {
            const lastInput = Number(last.input_tokens ?? 0) || 0;
            const lastOutput = Number(last.output_tokens ?? 0) || 0;
            const lastCached = Number(last.cached_input_tokens ?? 0) || 0;
            const activeUsage = ensureModelUsage(modelUsageByModel, model);
            if (activeUsage) {
              activeUsage.inputTokens += Math.max(0, lastInput - lastCached);
              activeUsage.outputTokens += lastOutput;
              activeUsage.cacheReadTokens += lastCached;
            }
          }
          if (tot) {
            const totalInput = Number(tot.input_tokens ?? 0) || 0;
            const totalOutput = Number(tot.output_tokens ?? 0) || 0;
            const totalCached = Number(tot.cached_input_tokens ?? 0) || 0;
            fallbackInputDelta = totalInput >= previousTotalInput
              ? totalInput - previousTotalInput
              : totalInput;
            fallbackOutputDelta = totalOutput >= previousTotalOutput
              ? totalOutput - previousTotalOutput
              : totalOutput;
            fallbackCachedDelta = totalCached >= previousTotalCached
              ? totalCached - previousTotalCached
              : totalCached;
            if (!last) {
              const activeUsage = ensureModelUsage(modelUsageByModel, model);
              if (activeUsage) {
                activeUsage.inputTokens += Math.max(0, fallbackInputDelta - fallbackCachedDelta);
                activeUsage.outputTokens += fallbackOutputDelta;
                activeUsage.cacheReadTokens += fallbackCachedDelta;
              }
            }
            previousTotalInput = totalInput;
            previousTotalOutput = totalOutput;
            previousTotalCached = totalCached;
          }
          if (last || tot) {
            sumIn += last ? Number(last.input_tokens ?? 0) || 0 : fallbackInputDelta;
            sumOut += last ? Number(last.output_tokens ?? 0) || 0 : fallbackOutputDelta;
            sumCached += last ? Number(last.cached_input_tokens ?? 0) || 0 : fallbackCachedDelta;
          }
          metricSources.tokens = "measured";
          if (at && (last || tot)) {
            let deltaInput: number;
            let deltaOutput: number;
            if (last) {
              const lastInput = Number(last.input_tokens ?? 0) || 0;
              const lastCached = Number(last.cached_input_tokens ?? 0) || 0;
              deltaInput = Math.max(0, lastInput - lastCached);
              deltaOutput = Number(last.output_tokens ?? 0) || 0;
            } else {
              // Older rollouts only record cumulative totals. Each component
              // may reset after context compaction, so derive deltas per field
              // and keep the chart in the same mutually exclusive token units
              // as the session summary (fresh input excludes cached input).
              deltaInput = Math.max(0, fallbackInputDelta - fallbackCachedDelta);
              deltaOutput = fallbackOutputDelta;
            }
            segmentInput += deltaInput;
            segmentOutput += deltaOutput;
            const elapsedSec = Math.max((at - startedAt) / 1000, 0.001);
            usageSegments.push({
              atMs: at,
              cumulativeInput: segmentInput,
              cumulativeOutput: segmentOutput,
              deltaInput,
              deltaOutput,
              outTokPerSec: segmentOutput / elapsedSec,
            });
          }
        }
      } else if (obj.type === "response_item") {
        const payload = obj.payload ?? {};
        if (payload.type === "reasoning") thinkingBlocks++;
        if (payload.type === "message") {
          textBlocks++;
          messageCount++;
          // Manual filter(Boolean)+join(" "): most message payloads produce no
          // kept text, and this path runs per response_item. `item.text` (not
          // item?.text) on purpose — a null item threw before and must still.
          let text = "";
          if (Array.isArray(payload.content)) {
            let first = true;
            for (const item of payload.content as any[]) {
              const t = item.text;
              if (!t) continue;
              if (!first) text += " ";
              text += t;
              first = false;
            }
          }
          if (payload.role === "user") responseUserMessageCount++;
          // OpenEval's own CLI-backed judge invocations leave codex_exec stub
          // sessions behind; they are instrumentation, not user work.
          if (payload.role === "user" && !lastPromptPreview && recordCodexUserText(text) === "judge") return null;
          // Injected wrappers ("<permissions instructions>", "<environment_context>")
          // and orchestrator persona preambles make useless titles — wait for
          // the first real message.
          if (displayTitle == null && text && !text.trim().startsWith("<") && !isInjectedPreamble(text, isSubagent)) displayTitle = jsonPreview(text, 80);
        }
        if (payload.type === "function_call") {
          toolCalls++;
          const name = String(payload.name ?? "(unknown)");
          increment(toolCallsByName, name);
          const activeUsage = ensureModelUsage(modelUsageByModel, model);
          if (activeUsage) activeUsage.toolCalls++;
          extractFilePaths(payload.arguments, touchedFiles);
          if (typeof payload.call_id === "string") {
            toolNameByCallIdMs.set(payload.call_id, name);
            if (activeUsage) toolModelByCallId.set(payload.call_id, activeUsage.model);
            if (at != null) toolStartByCallIdMs.set(payload.call_id, at);
          }
        }
        if (payload.type === "function_call_output") {
          const output = String(payload.output ?? "");
          extractFilePaths(output, touchedFiles);
          const errored = codexToolOutputError(output);
          if (typeof payload.call_id === "string") {
            const startMs = toolStartByCallIdMs.get(payload.call_id);
            if (startMs != null && at != null) {
              const delta = Math.max(0, at - startMs);
              const nm = toolNameByCallIdMs.get(payload.call_id) ?? "(unknown)";
              const list = toolDurationMs.get(nm) ?? [];
              list.push(delta);
              toolDurationMs.set(nm, list);
            }
            if (errored) {
              toolErrors++;
              increment(toolErrorsByName, toolNameByCallIdMs.get(payload.call_id) ?? "(unknown)");
              const errorUsage = ensureModelUsage(modelUsageByModel, toolModelByCallId.get(payload.call_id));
              if (errorUsage) errorUsage.toolErrors++;
            }
            toolStartByCallIdMs.delete(payload.call_id);
            toolNameByCallIdMs.delete(payload.call_id);
            toolModelByCallId.delete(payload.call_id);
          } else if (errored) {
            toolErrors++;
            increment(toolErrorsByName, "(unknown)");
          }
        }
      } else if (obj.type === "user_msg" || obj.type === "user_message") {
        const text = String(obj.payload?.message ?? obj.payload?.text ?? obj.message ?? obj.text ?? "");
        if (recordCodexUserText(text) === "judge") return null;
      }
    }
  } catch (e) {
    // See parseLiveSession's outer catch: fs errors must not become permanent
    // null tombstones in the session cache.
    if (typeof (e as { errno?: unknown })?.errno === "number") throw e;
    return null;
  }

  // Finalize tokens. Codex `input_tokens` INCLUDES the cached portion, so split
  // fresh = input − cached and report cacheRead = cached — otherwise input and
  // cacheRead double-count. Prefer summed per-turn usage; fall back to cumulative.
  {
    const totIn = sumIn;
    const totOut = sumOut;
    const cached = sumCached;
    cacheReadTokens = cached;
    inputTokens = Math.max(0, totIn - cached);
    outputTokens = totOut;
  }

  model = coalesceModel(model);
  const modelUsage = [...modelUsageByModel.values()]
    .filter((usage) => modelUsageVolume(usage) > 0 || usage.toolCalls > 0 || usage.toolErrors > 0)
    .map((usage) => ({ ...usage }));
  if (modelUsage.length > 0) {
    model = [...modelUsage].sort((a, b) =>
      modelUsageVolume(b) - modelUsageVolume(a) || b.toolCalls - a.toolCalls,
    )[0].model;
  }

  const durationMs = Math.max(0, lastEventAt - startedAt);
  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreateTokens;
  const toolSummaries = topEntries(toolCallsByName, 8).map(({ key, count }) => ({
    name: key,
    calls: count,
    errors: toolErrorsByName.get(key) ?? 0,
  }));
  const toolDurations = summarizeToolDurations(toolDurationMs, toolErrorsByName);
  // Codex session files carry no cost — estimate from measured tokens + model.
  let costUsd = 0;
  const estCost = modelUsage.length > 0
    ? estimateModelUsageCost(modelUsage)
    : estimateCostUsd(model, { input: inputTokens, output: outputTokens, cacheRead: cacheReadTokens, cacheCreate: cacheCreateTokens });
  if (estCost != null) {
    costUsd = estCost;
    metricSources.cost = "inferred";
  }

  const turnInferenceSource: "turnContext" | "userMessages" | "messageCount" = turnContextCount > 0
    ? "turnContext"
    : Math.max(responseUserMessageCount, eventUserMessageCount) > 0
      ? "userMessages"
      : "messageCount";
  const parseWarnings = buildWarnings(metricSources, malformedLineCount, lineCount, 0, true, model, turnInferenceSource);
  if (modelUsage.length > 1) parseWarnings.push(`mixed models: ${modelUsage.map((usage) => usage.model).join(", ")}`);
  if (originator) parseWarnings.push(`source: ${originator}${source ? ` / ${source}` : ""}${cliVersion ? ` ${cliVersion}` : ""}`);
  const toolErrorRate = toolCalls > 0 ? toolErrors / toolCalls : 0;

  return {
    sessionId: sessionId ?? path.basename(file, ".jsonl"),
    displayTitle,
    lastPromptPreview,
    project,
    model,
    startedAt,
    lastEventAt,
    durationMs,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreateTokens,
    totalTokens,
    costUsd,
    modelUsage: modelUsage.length > 0 ? modelUsage : undefined,
    usageSegments: downsampleUsageSegments(usageSegments),
    toolCalls,
    toolErrors,
    numTurns: Math.max(
      turnContextCount > 0
        ? turnContextCount
        : Math.max(responseUserMessageCount, eventUserMessageCount),
      1,
    ),
    stopReason: null,
    isError: toolErrors > 0,
    pathBytes,
    path: file,
    lineCount,
    malformedLineCount,
    thinkingBlocks,
    textBlocks,
    attachmentCount: 0,
    queueOperationCount: 0,
    snapshotCount: 0,
    hookErrors: 0,
    messageCount,
    userType: originator ?? source,
    dataQuality: scoreQuality(metricSources, malformedLineCount, lineCount, 0, toolErrorRate),
    metricSources,
    parseWarnings,
    toolErrorRate,
    toolCallsPerTurn: turnContextCount > 0 || responseUserMessageCount > 0 || eventUserMessageCount > 0
      ? toolCalls / Math.max(turnContextCount, responseUserMessageCount, eventUserMessageCount)
      : toolCalls,
    textAvailability: lineCount > 0 ? textBlocks / lineCount : 0,
    staleMs: Math.max(0, Date.now() - lastEventAt),
    traceGraph: {
      rootMessages: messageCount,
      sidechainMessages: 0,
      agentCount: 0,
      orphanMessages: 0,
    },
    toolSummaries,
    toolDurations,
    queueSummary: { enqueue: 0, dequeue: 0, remove: 0, popAll: 0, preview: [] },
    fileActivity: {
      touchedFiles: [...touchedFiles].sort().slice(0, 12),
      readLikeOperations: toolSummaries.filter((tool) => /read|grep|search|find|open/i.test(tool.name)).reduce((sum, tool) => sum + tool.calls, 0),
      writeLikeOperations: toolSummaries.filter((tool) => /write|edit|patch|apply/i.test(tool.name)).reduce((sum, tool) => sum + tool.calls, 0),
    },
    modeSummary: {
      permissionModes: {},
      gitBranch: null,
      entrypoint: source ?? originator,
    },
    skillsUsed: [],
    mcpServersUsed: [],
    subagentSpawns: 0,
    cliVersion,
    outcomeSignals: {
      userPositive,
      userNegative,
      rephrases,
      errorTail: looksLikeApologyOrFailure(lastAgentText),
      testsPassedTail: looksLikeTestsPassed(lastAgentText),
      reworkFiles: 0,
    },
  };
}
