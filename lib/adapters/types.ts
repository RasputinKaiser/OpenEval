import type { PermissionMode, RunnerContext, RunnerEvent, RunnerResult, TranscriptEntry } from "../types";
import type { NormalizedDescriptor } from "./schema";

export type HarnessId = string;
export type CapabilityValue = boolean | null;

export interface AdapterCapabilities {
  outputFormat: "stream-json" | "jsonl" | "text" | "json";
  reportsCost: boolean;
  reportsTokens: boolean;
  reportsTurns: boolean;
  permissionModes: PermissionMode[];
  /** null means the descriptor does not have enough evidence to claim yes/no. */
  supportsVisionInput: CapabilityValue;
}

export interface BuiltCommand {
  bin: string;
  args: string[];
  env: Record<string, string>;
  /** When set, written to the harness process's stdin (prompt mode "stdin"). */
  stdin?: string;
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
  /** The validated descriptor this adapter was built from. All adapters are descriptor-defined. */
  descriptor: NormalizedDescriptor;
  buildCommand(ctx: RunnerContext): BuiltCommand;
  parseLine(line: string, acc: ParseAccumulator): RunnerEvent[];
}
