export type ModelMetric = "cost" | "sessions" | "tokens" | "cache" | "tools" | "errors";
export interface ModelMeasures { costUsd: number; sessions: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; toolCalls: number; toolErrors: number }
export function modelMeasure(model: ModelMeasures, metric: ModelMetric): number {
  switch (metric) {
    case "sessions": return model.sessions;
    case "tokens": return model.inputTokens + model.outputTokens;
    case "cache": return model.cacheReadTokens;
    case "tools": return model.toolCalls;
    case "errors": return model.toolCalls > 0 ? model.toolErrors / model.toolCalls : 0;
    default: return model.costUsd;
  }
}
export function modelBarFraction(model: ModelMeasures, population: readonly ModelMeasures[], metric: ModelMetric): number {
  if (metric === "errors") return modelMeasure(model, metric);
  const total = population.reduce((sum, row) => sum + modelMeasure(row, metric), 0);
  return total > 0 ? modelMeasure(model, metric) / total : 0;
}
