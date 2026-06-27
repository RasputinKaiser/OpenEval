import { HeadlessRunner } from "./headless";
import { TmuxRunner } from "./tmux";
import type { Runner, RunnerKind } from "../types";

export { HeadlessRunner, TmuxRunner };

export function getRunner(kind: RunnerKind): Runner {
  switch (kind) {
    case "tmux": return new TmuxRunner();
    case "headless":
    default: return new HeadlessRunner();
  }
}