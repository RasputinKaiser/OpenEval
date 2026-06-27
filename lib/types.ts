export type Category = "agentic-swe" | "single-tool" | "reasoning";

export type Difficulty = "easy" | "medium" | "hard";

export type PermissionMode =
  | "bypassPermissions"
  | "default"
  | "acceptEdits"
  | "dontAsk"
  | "plan"
  | "auto";

export type GraderSpecVariant =
  | { type: "exit_code"; command: string; cwd?: string; env?: Record<string, string>; timeout_ms?: number; weight?: number }
  | { type: "tests_pass"; command: string; cwd?: string; env?: Record<string, string>; timeout_ms?: number; weight?: number }
  | { type: "file_contains"; path: string; pattern: string; negate?: boolean; weight?: number }
  | { type: "file_exists"; path: string; negate?: boolean; weight?: number }
  | { type: "file_eq"; path: string; expected: string; trim?: boolean; weight?: number }
  | { type: "regex_match"; pattern: string; source?: "stdout" | "final_text" | "transcript"; negate?: boolean; weight?: number }
  | { type: "json_path"; path: string; jsonpath: string; equals: unknown; weight?: number }
  | { type: "files_unchanged"; paths: string[]; fixture?: string; weight?: number }
  | { type: "file_deleted"; path: string; weight?: number }
  | { type: "git_diff_contains"; pattern: string; negate?: boolean; pathFilter?: string; weight?: number }
  | { type: "checksum"; path: string; algorithm?: "sha256" | "md5"; expected: string; weight?: number }
  | { type: "step"; tool?: string; input_includes?: string; input_includes_any?: string[]; at_index?: number; min_count?: number; before_tool?: string; negate?: boolean; weight?: number }
  | { type: "rubric_llm"; rubric: string; min_score?: number; model?: string; weight?: number }
  | { type: "manual"; note?: string; weight?: number };

export type GraderSpec = GraderSpecVariant & { forbidden?: boolean };

export type EvidenceTier = "deterministic" | "trace" | "visual" | "llm_judge" | "manual";

export interface CaseDefinition {
  id: string;
  category: Category;
  difficulty?: Difficulty;
  name: string;
  description?: string;
  tags?: string[];
  split?: "public" | "held_out";
  canary?: string;
  prompt: string;
  setup?: {
    type: "none" | "fixture" | "git-clone";
    fixture?: string;
    repo?: string;
    workdir_name?: string;
    init_git?: boolean;
  };
  runner?: {
    max_turns?: number;
    timeout_seconds?: number;
    permission_mode?: PermissionMode;
    model?: string;
    extra_args?: string[];
  };
  budget?: {
    max_cost_usd?: number;
    max_turns?: number;
  };
  oracle?: {
    solve?: string;
    final_text?: string;
    noop_max_score?: number;
    known_bad?: string[];
  };
  visual?: {
    kind: "svg" | "threejs" | "web_ui" | "app_ui" | "screenshot";
    requires_vision_input?: boolean;
    expected_artifacts?: string[];
  };
  graders: GraderSpec[];
  pass_threshold?: number;
}

export type RunnerKind = "headless" | "tmux";

export interface RunnerContext {
  caseId: string;
  workdir: string;
  prompt: string;
  maxTurns: number;
  timeoutMs: number;
  permissionMode: PermissionMode;
  model?: string;
  extraArgs: string[];
  onEvent?: (event: RunnerEvent) => void;
}

export type RunnerEvent =
  | { kind: "started"; pid?: number; at: number }
  | { kind: "log"; stream: "stdout" | "stderr"; chunk: string; at: number }
  | { kind: "message"; message: TranscriptEntry; at: number }
  | { kind: "tool_use"; tool: string; input?: unknown; id: string; at: number }
  | { kind: "tool_result"; id: string; output?: string; isError?: boolean; at: number }
  | { kind: "finished"; at: number; durationMs: number; exitCode: number };

export interface TranscriptEntry {
  role: "assistant" | "user" | "system";
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input?: unknown }
    | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
  >;
  uuid?: string;
  atMs?: number;
  textLen?: number;
}

export interface TokenSegment {
  atMs: number;
  cumulativeInput: number;
  cumulativeOutput: number;
  deltaOutput: number;
  deltaInput: number;
  outTokPerSec: number;
}

export interface RunnerResult {
  exitCode: number;
  durationMs: number;
  startedAt: number | null;
  endedAt: number | null;
  transcript: TranscriptEntry[];
  toolCalls: Array<{ id: string; name: string; input?: unknown; output?: string; isError?: boolean; atMs?: number; durationMs?: number }>;
  finalText: string;
  resultText: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreateTokens: number;
    costUsd: number;
  };
  numTurns: number;
  stopReason: string | null;
  sessionId: string | null;
  model: string | null;
  isError: boolean;
  rawJson: unknown;
  tokenSegments: TokenSegment[];
  toolCallCounts: Record<string, number>;
}

export interface CaseTelemetry {
  tokPerSec: number;
  inTokPerSec: number;
  toolCallCount: number;
  toolCallCounts: Record<string, number>;
  errorCount: number;
  cacheHitRate: number;
  tokensPerCase: number;
  costPerCase: number;
  msPerTurn: number;
  msPerTool: number;
}

export interface RunTelemetry {
  p50DurationMs: number;
  p95DurationMs: number;
  p50TokPerSec: number;
  maxTokPerSec: number;
  avgTokPerSec: number;
  totalToolCalls: number;
  topTools: Array<{ name: string; count: number }>;
  cacheHitRate: number;
  errorRate: number;
  avgTurns: number;
  forbiddenViolationRate: number;
  failsSafelyRate: number;
  cheapestPassUsd: number;
  perCase: Array<{ caseId: string; caseName: string; tokPerSec: number; inTokPerSec: number; durationMs: number; costUsd: number; tokens: number; passed: boolean }>;
}

export interface GraderResult {
  spec: GraderSpec;
  passed: boolean;
  detail: string;
  durationMs: number;
  score: number;
  evidenceTier?: EvidenceTier;
  evidenceLabel?: string;
  output?: string;
}

export interface CaseEvaluation {
  passed: boolean;
  passRatio: number;
  results: GraderResult[];
  durationMs: number;
}

export interface RunCaseRecord {
  id: string;
  run_id: string;
  case_id: string;
  case_name: string;
  category: Category;
  difficulty?: Difficulty;
  status: "pending" | "running" | "grading" | "passed" | "failed" | "error" | "skipped";
  started_at: number | null;
  ended_at: number | null;
  workdir_path: string;
  transcript_path: string | null;
  runner_kind: RunnerKind;
  runner_result: RunnerResult | null;
  grader_result: CaseEvaluation | null;
  budget_exceeded?: boolean;
  error_msg: string | null;
  case_def: CaseDefinition;
  seq?: number;
  sample?: number;
}

export interface RunRecord {
  id: string;
  name: string;
  status: "running" | "completed" | "failed" | "aborted";
  created_at: number;
  ended_at: number | null;
  params: {
    runner: RunnerKind;
    parallel: number;
    model?: string;
    samples?: number;
    filter?: { caseIds?: string[]; categories?: string[]; tags?: string[]; difficulty?: string[] };
  };
  summary: RunSummary | null;
}

export interface Runner {
  kind: "headless" | "tmux";
  run(ctx: RunnerContext): Promise<RunnerResult>;
}

export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
  passRate: number;
  passAt1?: number;
  passAtK?: number;
  passPowK?: number;
  samples?: number;
  totalCostUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalDurationMs: number;
  byCategory: Record<string, { total: number; passed: number; failed: number; errored: number }>;
  byDifficulty?: Record<string, { total: number; passed: number; failed: number; errored: number }>;
}
