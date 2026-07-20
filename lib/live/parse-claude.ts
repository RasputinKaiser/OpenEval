import path from "node:path";
import { getPath, type FieldMapping } from "../adapters/generic";
import { classifySentiment, isRephraseTracked, looksLikeApologyOrFailure, looksLikeTestsPassed, mcpServerFromTool, JUDGE_PROMPT_MARKER } from "../insights/signals";
import { estimateCostUsd } from "../pricing";
import type { LiveMetricSources, LiveModelUsage, LiveQueueSummary, LiveSession, LiveUsageSegment } from "./types";
import { NON_WS_RE, READ_LIKE_TOOL_HINTS, WRITE_TOOL_NAMES, booleanOrNull, buildUsageSegments, buildWarnings, coalesceModel, coalesceString, decodeProjectDir, downsampleUsageSegments, ensureModelUsage, estimateModelUsageCost, extractFilePaths, increment, incrementRecord, jsonPreview, modelUsageVolume, numericOrNull, parseTimestamp, scoreQuality, summarizeToolDurations, topEntries } from "./util";

export function parseLiveSession(file: string, lines: Iterable<string>, bytes: number, projectDir: string, mtime: number, fields?: FieldMapping, inferredModel?: string, decodeProject = true): LiveSession | null {
  let model: string | null = null;
  let sessionId: string | null = null;
  let displayTitle: string | null = null;
  let lastPromptPreview: string | null = null;
  // Only dash-encoded formats (claude-projects / ncode) need decoding; jsonl-dir
  // project names are already real relative paths and get corrupted by it.
  let project = decodeProject ? decodeProjectDir(projectDir) : projectDir;
  // Longitudinal markers + heuristic outcome signals.
  const skillsUsed = new Set<string>();
  const mcpServersUsed = new Set<string>();
  let subagentSpawns = 0;
  let cliVersion: string | null = null;
  const writeCountByFile = new Map<string, number>();
  let userPositive = 0, userNegative = 0, rephrases = 0;
  let lastUserText: string | null = null;
  // Carries lastUserText's token set between isRephraseTracked calls; must
  // only be touched by that call, in lockstep with lastUserText assignments.
  const rephraseCache: { tokens: Set<string> | null } = { tokens: null };
  let lastAssistantText = "";
  let userTextTurns = 0;
  let firstTsMs = Infinity;
  let lastTsMs = 0;
  let tsCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreateTokens = 0;
  let costUsd = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let numTurns = 0;
  let durationMs = 0;
  let stopReason: string | null = null;
  let isError = false;
  let declaredTurnCount: number | null = null;
  let turnInferenceSource: "messageCount" | "userMessages" | undefined;
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
  let rootMessages = 0;
  let sidechainMessages = 0;
  let gitBranch: string | null = null;
  let entrypoint: string | null = null;
  const seenUuids = new Set<string>();
  const parentUuids = new Set<string>();
  const agentIds = new Set<string>();
  const toolNameById = new Map<string, string>();
  const toolModelById = new Map<string, string>();
  const toolCallsByName = new Map<string, number>();
  const toolStartByIdMs = new Map<string, number>();
  const toolDurationMs = new Map<string, number[]>();
  const toolErrorsByName = new Map<string, number>();
  const queueSummary: LiveQueueSummary = { enqueue: 0, dequeue: 0, remove: 0, popAll: 0, preview: [] };
  const touchedFiles = new Set<string>();
  const permissionModes: Record<string, number> = {};
  const modelUsageByModel = new Map<string, LiveModelUsage>();
  let readLikeOperations = 0;
  let writeLikeOperations = 0;
  let usageSegments: LiveUsageSegment[] = [];

  const metricSources: LiveMetricSources = {
    model: "missing",
    tokens: "missing",
    cost: "missing",
    duration: "missing",
    turns: "missing",
  };

  try {
    pathBytes = bytes;
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

      const at = parseTimestamp(obj.timestamp) ?? parseTimestamp(obj.created_at) ?? null;
      if (at) {
        startedAt = Math.min(startedAt, at);
        lastEventAt = Math.max(lastEventAt, at);
        firstTsMs = Math.min(firstTsMs, at);
        lastTsMs = Math.max(lastTsMs, at);
        tsCount++;
      }

      if (typeof obj.uuid === "string") seenUuids.add(obj.uuid);
      if (typeof obj.parentUuid === "string" && obj.parentUuid) parentUuids.add(obj.parentUuid);
      if (obj.isSidechain === true) sidechainMessages++;
      if (obj.isSidechain === false) rootMessages++;
      if (typeof obj.agentId === "string") agentIds.add(obj.agentId);
      if (typeof obj.gitBranch === "string" && obj.gitBranch) gitBranch = obj.gitBranch;
      if (typeof obj.entrypoint === "string" && obj.entrypoint) entrypoint = obj.entrypoint;
      if (typeof obj.permissionMode === "string") incrementRecord(permissionModes, obj.permissionMode);
      if (typeof obj.sessionId === "string" && obj.sessionId) sessionId = obj.sessionId;
      if (typeof obj.cwd === "string" && obj.cwd) project = obj.cwd;
      if (typeof obj.userType === "string" && obj.userType) userType = obj.userType;
      if (typeof obj.version === "string" && obj.version) cliVersion = obj.version;

      // Human sentiment/rephrase — only real, short-ish user turns (skip
      // tool-results, injected <system-reminder>/command wrappers, pasted blobs).
      if (obj.type === "user" && obj.message && obj.isSidechain !== true) {
        const c = obj.message.content;
        // Manual join(" ") over text blocks: the common tool_result-only user
        // record exits with zero allocations instead of filter+map+join.
        let userText = "";
        if (typeof c === "string") {
          userText = c;
        } else if (Array.isArray(c)) {
          let first = true;
          for (const b of c) {
            if (b?.type !== "text") continue;
            if (!first) userText += " ";
            userText += b.text ?? "";
            first = false;
          }
        }
        const trimmed = userText.trim();
        // A claude-CLI-backed judge leaves its own session files; drop them.
        if (trimmed.startsWith(JUDGE_PROMPT_MARKER)) return null;
        if (trimmed && !trimmed.startsWith("<") && !trimmed.startsWith("Caveat:")) {
          userTextTurns++;
          if (trimmed.length <= 600) {
            const sent = classifySentiment(trimmed);
            if (sent === "positive") userPositive++;
            else if (sent === "negative") userNegative++;
            if (isRephraseTracked(trimmed, lastUserText, rephraseCache)) rephrases++;
            lastUserText = trimmed;
          }
        }
      }

      if (obj.type === "system") {
        // "<synthetic>" is Claude Code's placeholder model on API-error turns,
        // not a real model — letting it win would misattribute (and mis-price)
        // the whole session's usage.
        model = coalesceModel(obj.model, model);
        sessionId = obj.sessionId ?? obj.session_id ?? sessionId;
        project = obj.cwd ?? obj.project ?? project;
        userType = obj.userType ?? userType;
        stopReason = obj.stopReason ?? stopReason;
        hookErrors += Number(obj.hookErrors ?? 0) || 0;
        messageCount = Math.max(messageCount, Number(obj.messageCount ?? 0) || 0);
        if (Number.isFinite(Number(obj.turnCount))) declaredTurnCount = Math.max(0, Number(obj.turnCount));
        if (typeof obj.durationMs === "number") {
          durationMs = Math.max(durationMs, obj.durationMs);
          metricSources.duration = "measured";
        }
        if (typeof obj.totalDurationMs === "number") {
          durationMs = Math.max(durationMs, obj.totalDurationMs);
          metricSources.duration = "measured";
        }
      } else if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
        model = coalesceModel(obj.message?.model, model);
        // coalesceModel(m, model) here is provably `model` again: model is
        // always null-or-normalized and normalize is idempotent.
        const messageModel = model;
        const modelUsage = ensureModelUsage(modelUsageByModel, messageModel);
        const messageUsage = obj.message?.usage ?? {};
        const messageInput = numericOrNull(messageUsage.input_tokens);
        const messageOutput = numericOrNull(messageUsage.output_tokens);
        const messageCacheRead = numericOrNull(messageUsage.cache_read_input_tokens);
        const messageCacheCreate = numericOrNull(messageUsage.cache_creation_input_tokens);
        if (messageInput != null || messageOutput != null || messageCacheRead != null || messageCacheCreate != null) {
          const deltaInput = messageInput ?? 0;
          const deltaOutput = messageOutput ?? 0;
          inputTokens += deltaInput;
          outputTokens += deltaOutput;
          cacheReadTokens += messageCacheRead ?? 0;
          cacheCreateTokens += messageCacheCreate ?? 0;
          if (modelUsage) {
            modelUsage.inputTokens += deltaInput;
            modelUsage.outputTokens += deltaOutput;
            modelUsage.cacheReadTokens += messageCacheRead ?? 0;
            modelUsage.cacheCreateTokens += messageCacheCreate ?? 0;
          }
          metricSources.tokens = "measured";
          if (at) {
            const elapsedSec = Math.max((at - startedAt) / 1000, 0.001);
            usageSegments.push({
              atMs: at,
              cumulativeInput: inputTokens,
              cumulativeOutput: outputTokens,
              deltaInput,
              deltaOutput,
              outTokPerSec: outputTokens / elapsedSec,
            });
          }
        }
        let assistantText = "";
        for (const b of obj.message.content) {
          if (b.type === "tool_use") {
            toolCalls++;
            if (typeof b.id === "string" && typeof b.name === "string") {
              toolNameById.set(b.id, b.name);
              if (modelUsage) toolModelById.set(b.id, modelUsage.model);
              if (at != null) toolStartByIdMs.set(b.id, at);
            }
            if (modelUsage) modelUsage.toolCalls++;
            if (typeof b.name === "string") increment(toolCallsByName, b.name);
            extractFilePaths(b.input, touchedFiles);
            const rawName = String(b.name ?? "");
            const name = rawName.toLowerCase();
            if (READ_LIKE_TOOL_HINTS.some((tool) => name.includes(tool))) readLikeOperations++;
            const isWrite = WRITE_TOOL_NAMES.some((tool) => name === tool || name.startsWith(tool));
            if (name.includes("write") || name.includes("edit")) writeLikeOperations++;
            // --- markers --- (subagent spawns are "Task" or "Agent" across versions)
            if (rawName === "Task" || rawName === "Agent") subagentSpawns++;
            if (rawName === "Skill") {
              const s = (b.input as any)?.skill ?? (b.input as any)?.command ?? (b.input as any)?.name;
              if (typeof s === "string" && s) skillsUsed.add(s);
            }
            const server = mcpServerFromTool(rawName);
            if (server) mcpServersUsed.add(server);
            // --- rework: count writes per file (a file rewritten 2+ times = churn) ---
            if (isWrite) {
              const fp = (b.input as any)?.file_path ?? (b.input as any)?.path;
              if (typeof fp === "string" && fp) writeCountByFile.set(fp, (writeCountByFile.get(fp) ?? 0) + 1);
            }
          }
          if (b.type === "thinking") thinkingBlocks++;
          if (b.type === "text") { textBlocks++; if (typeof b.text === "string") assistantText += b.text; }
        }
        if (assistantText.trim()) lastAssistantText = assistantText;
      } else if (obj.type === "user" && Array.isArray(obj.message?.content)) {
        for (const b of obj.message.content) {
          if (b.type === "tool_result") {
            const startMs = typeof b.tool_use_id === "string" ? toolStartByIdMs.get(b.tool_use_id) : undefined;
            if (startMs != null && at != null) {
              const delta = Math.max(0, at - startMs);
              const nm = toolNameById.get(b.tool_use_id as string) ?? "(unknown)";
              const list = toolDurationMs.get(nm) ?? [];
              list.push(delta);
              toolDurationMs.set(nm, list);
            }
            if (typeof b.tool_use_id === "string") toolStartByIdMs.delete(b.tool_use_id);
          }
          if (b.type === "tool_result" && b.is_error) {
            toolErrors++;
            increment(toolErrorsByName, toolNameById.get(b.tool_use_id) ?? "(unknown)");
            const errorModel = typeof b.tool_use_id === "string" ? toolModelById.get(b.tool_use_id) : null;
            const errorUsage = ensureModelUsage(modelUsageByModel, errorModel);
            if (errorUsage) errorUsage.toolErrors++;
          }
        }
      } else if (obj.type === "attachment") {
        attachmentCount++;
        extractFilePaths(obj.attachment, touchedFiles);
        const attachmentType = obj.attachment?.type;
        if (attachmentType === "edited_text_file") writeLikeOperations++;
      } else if (obj.type === "queue-operation") {
        queueOperationCount++;
        if (obj.operation === "enqueue") queueSummary.enqueue++;
        else if (obj.operation === "dequeue") queueSummary.dequeue++;
        else if (obj.operation === "remove") queueSummary.remove++;
        else if (obj.operation === "popAll") queueSummary.popAll++;
        if (typeof obj.content === "string" && queueSummary.preview.length < 3) queueSummary.preview.push(jsonPreview(obj.content, 220));
      } else if (obj.type === "file-history-snapshot") {
        snapshotCount++;
        extractFilePaths(obj.snapshot, touchedFiles);
      } else if (obj.type === "result") {
        sawResult = true;
        const usage = obj.usage || {};
        inputTokens = usage.input_tokens ?? inputTokens;
        outputTokens = usage.output_tokens ?? outputTokens;
        cacheReadTokens = usage.cache_read_input_tokens ?? cacheReadTokens;
        cacheCreateTokens = usage.cache_creation_input_tokens ?? cacheCreateTokens;
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
      } else if (obj.type === "last-prompt") {
        if (typeof obj.lastPrompt === "string") lastPromptPreview = jsonPreview(obj.lastPrompt, 260);
      } else if (obj.type === "custom-title") {
        if (typeof obj.customTitle === "string") displayTitle = obj.customTitle;
      } else if (obj.type === "agent-name") {
        if (!displayTitle && typeof obj.agentName === "string") displayTitle = obj.agentName;
      }

      if (fields) {
        const f = fields;
        model = coalesceModel(getPath(obj, f.model), model);
        sessionId = coalesceString(getPath(obj, f.sessionId), sessionId);
        const genericDuration = numericOrNull(getPath(obj, f.durationMs));
        if (genericDuration != null) {
          durationMs = Math.max(durationMs, genericDuration);
          metricSources.duration = "measured";
        }
        const genericInput = numericOrNull(getPath(obj, f.inputTokens));
        const genericOutput = numericOrNull(getPath(obj, f.outputTokens));
        const genericCacheRead = numericOrNull(getPath(obj, f.cacheReadTokens));
        const genericCacheCreate = numericOrNull(getPath(obj, f.cacheCreateTokens));
        if (genericInput != null || genericOutput != null || genericCacheRead != null || genericCacheCreate != null) {
          inputTokens = genericInput ?? inputTokens;
          outputTokens = genericOutput ?? outputTokens;
          cacheReadTokens = genericCacheRead ?? cacheReadTokens;
          cacheCreateTokens = genericCacheCreate ?? cacheCreateTokens;
          metricSources.tokens = "measured";
        }
        const genericCost = numericOrNull(getPath(obj, f.costUsd));
        if (genericCost != null) {
          costUsd = genericCost;
          metricSources.cost = "measured";
        }
        const genericTurns = numericOrNull(getPath(obj, f.numTurns));
        if (genericTurns != null) {
          numTurns = genericTurns;
          metricSources.turns = "measured";
        }
        stopReason = coalesceString(getPath(obj, f.stopReason), stopReason);
        const genericError = booleanOrNull(getPath(obj, f.isError));
        if (genericError != null) isError = genericError;
      }
    }
  } catch (e) {
    // Filesystem errors (ENOENT mid-scan, EMFILE, EIO) are transient: rethrow
    // so summarizeWithCache skips the file WITHOUT caching, else the failure
    // is stored as a permanent null tombstone that outlives the outage.
    // Content-deterministic failures (JSON/Type/RangeError) carry no errno and
    // still cache as null — correct for genuinely unparseable files.
    if (typeof (e as { errno?: unknown })?.errno === "number") throw e;
    return null;
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
  if (model) {
    metricSources.model = "measured";
  } else if (coalesceModel(inferredModel)) {
    model = coalesceModel(inferredModel);
    metricSources.model = "inferred";
  }
  if (numTurns === 0 && declaredTurnCount != null) {
    numTurns = declaredTurnCount;
    metricSources.turns = "inferred";
    turnInferenceSource = "userMessages";
  } else if (numTurns === 0 && messageCount > 0) {
    numTurns = messageCount;
    metricSources.turns = "inferred";
    turnInferenceSource = "messageCount";
  } else if (numTurns === 0 && userTextTurns > 0) {
    // Interactive sessions carry no result/messageCount record; the count of
    // real (non-sidechain, non-injected) user prompts is the honest fallback.
    numTurns = userTextTurns;
    metricSources.turns = "inferred";
    turnInferenceSource = "userMessages";
  } else if (numTurns > 0 && metricSources.turns === "missing") {
    metricSources.turns = sawResult ? "measured" : "inferred";
    turnInferenceSource = "messageCount";
  }
  // Interactive sessions also lack duration records, but nearly every record
  // carries a timestamp — infer the observed span rather than reporting 0
  // (same derivation the Codex parser uses, tagged "inferred" not "measured").
  if (metricSources.duration === "missing" && tsCount >= 2 && lastTsMs > firstTsMs) {
    durationMs = Math.max(durationMs, lastTsMs - firstTsMs);
    metricSources.duration = "inferred";
  }
  if (malformedLineCount > 0 && lineCount === malformedLineCount) {
    metricSources.model = "malformed";
    metricSources.tokens = "malformed";
    metricSources.cost = "malformed";
    metricSources.duration = "malformed";
    metricSources.turns = "malformed";
  }
  // Persisted session files carry token usage but no cost — estimate it from the
  // measured tokens + model list price. Tagged "inferred", never "measured".
  if (metricSources.cost === "missing") {
    const est = modelUsage.length > 0
      ? estimateModelUsageCost(modelUsage)
      : estimateCostUsd(model, { input: inputTokens, output: outputTokens, cacheRead: cacheReadTokens, cacheCreate: cacheCreateTokens });
    if (est != null) {
      costUsd = est;
      metricSources.cost = "inferred";
    }
  }

  const parseWarnings = buildWarnings(metricSources, malformedLineCount, lineCount, hookErrors, sawResult, model, turnInferenceSource);
  const subagentId = rootMessages === 0 && sidechainMessages > 0 && agentIds.size === 1
    ? [...agentIds][0]
    : null;
  if (subagentId) parseWarnings.push("source: subagent");
  if (modelUsage.length > 1) parseWarnings.push(`mixed models: ${modelUsage.map((usage) => usage.model).join(", ")}`);
  const toolErrorRate = toolCalls > 0 ? toolErrors / toolCalls : 0;
  const toolCallsPerTurn = numTurns > 0 ? toolCalls / numTurns : 0;
  const textAvailability = lineCount > 0 ? textBlocks / lineCount : 0;
  const staleMs = Math.max(0, Date.now() - lastEventAt);
  const orphanMessages = [...parentUuids].filter((parentUuid) => !seenUuids.has(parentUuid)).length;
  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreateTokens;
  if (usageSegments.length === 0) {
    usageSegments = buildUsageSegments(startedAt, durationMs, inputTokens, outputTokens);
  }
  usageSegments = downsampleUsageSegments(usageSegments);
  const toolSummaries = topEntries(toolCallsByName, 8).map(({ key, count }) => ({
    name: key,
    calls: count,
    errors: toolErrorsByName.get(key) ?? 0,
  }));
  const toolDurations = summarizeToolDurations(toolDurationMs, toolErrorsByName);

  return {
    sessionId: subagentId
      ? `${sessionId ?? path.basename(file, ".jsonl")}/agent-${subagentId}`
      : sessionId ?? path.basename(file, ".jsonl"),
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
    usageSegments,
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
    traceGraph: {
      rootMessages,
      sidechainMessages,
      agentCount: agentIds.size,
      orphanMessages,
    },
    toolSummaries,
    toolDurations,
    queueSummary,
    fileActivity: {
      touchedFiles: [...touchedFiles].sort().slice(0, 12),
      readLikeOperations,
      writeLikeOperations,
    },
    modeSummary: {
      permissionModes,
      gitBranch,
      entrypoint,
    },
    skillsUsed: [...skillsUsed].sort(),
    mcpServersUsed: [...mcpServersUsed].sort(),
    subagentSpawns,
    cliVersion,
    outcomeSignals: {
      userPositive,
      userNegative,
      rephrases,
      errorTail: isError || looksLikeApologyOrFailure(lastAssistantText),
      testsPassedTail: looksLikeTestsPassed(lastAssistantText),
      reworkFiles: [...writeCountByFile.values()].filter((n) => n >= 2).length,
    },
  };
}
