import type { RunnerContext, RunnerEvent } from "../types";
export { parseStreamLine } from "../adapters/stream-json";

export interface Runner {
  kind: "headless" | "tmux";
  run(ctx: RunnerContext): Promise<import("../types").RunnerResult>;
}

export function emit(ctx: RunnerContext, ev: RunnerEvent): void {
  ctx.onEvent?.(ev);
}
