import type { PermissionMode, RunnerContext, RunnerEvent, RunnerResult, TranscriptEntry } from "../types";

export type HarnessId = string;

export interface AdapterCapabilities {
  outputFormat: "stream-json" | "jsonl" | "text" | "json";
  reportsCost: boolean;
  reportsTokens: boolean;
  reportsTurns: boolean;
  permissionModes: PermissionMode[];
  supportsVisionInput: boolean;
}

export interface BuiltCommand {
  bin: string;
  args: string[];
  env: Record<string, string>;
}

export interface ParseAccumulator {
  startedAt: number;
  transcript: TranscriptEntry[];
  toolCalls: RunnerResult["toolCalls"];
  finalText: string;
  result: Partial<RunnerResult> | null;
}

export interface HarnessAdapter {
  id: HarnessId;
  label: string;
  binNames: string[];
  defaultBin: string;
  wellKnownPaths?: string[];
  versionArgs?: string[];
  capabilities: AdapterCapabilities;
  buildCommand(ctx: RunnerContext): BuiltCommand;
  parseLine(line: string, acc: ParseAccumulator): RunnerEvent[];
}
