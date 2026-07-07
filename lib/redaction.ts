const USER_PATH_RE = /\/(Users|home)\/([^/\s]+)/g;
const RAMPART_MODEL = "nationaldesignstudio/rampart";
const RAMPART_IMPORT_SPECIFIER = "@huggingface/transformers" as string;
const MAX_PII_CHUNK_LENGTH = 1500;

type RedactionLayer = "pii" | "secrets" | "paths";

interface RedactTextOptions {
  paths?: boolean;
  secrets?: boolean;
  pii?: boolean;
}

interface RedactionLayerReport {
  layer: RedactionLayer;
  applied: boolean;
  changed: boolean;
}

interface EntitySpan {
  type: string;
  word: string;
  start?: number;
  end?: number;
}

let pipelinePromise: Promise<any> | null = null;

const SECRET_PATTERNS: Array<[kind: string, pattern: RegExp]> = [
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ["jwt", /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g],
  ["openai-key", /sk-[A-Za-z0-9_-]{20,}/g],
  ["github-token", /gh[pousr]_[A-Za-z0-9]{36}/g],
  ["aws-key", /AKIA[0-9A-Z]{16}/g],
  ["slack-token", /xox[baprs]-[A-Za-z0-9-]{10,}/g],
  ["bearer", /(?<=Bearer\s)[A-Za-z0-9._~+/=-]{16,}/g],
];

export function redactSensitiveText(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .replace(USER_PATH_RE, "/$1/[redacted]")
    .replace(/(-Users-)([^-\s/]+)(-)/g, "$1[redacted]$3")
    .replace(/(-home-)([^-\s/]+)(-)/g, "$1[redacted]$3");
}

export function compactDisplayPath(value: unknown, redact: boolean): string {
  const raw = String(value ?? "");
  if (!redact) return raw;
  const text = redact ? redactSensitiveText(raw) : raw;
  const homeMatch = text.match(/^\/Users\/(?:\[redacted\]|[^/]+)\/(.+)$/) || text.match(/^\/home\/(?:\[redacted\]|[^/]+)\/(.+)$/);
  if (homeMatch) return `~/${homeMatch[1]}`;
  return text;
}

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce(
    (current, [kind, pattern]) => current.replace(pattern, `[REDACTED:${kind}]`),
    text,
  );
}

async function getRampart(): Promise<any> {
  try {
    const transformers = await import(RAMPART_IMPORT_SPECIFIER);
    return transformers;
  } catch (error) {
    throw error;
  }
}

async function getRampartPipeline(): Promise<any> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const rampart = await getRampart();
      const pipeline = rampart.pipeline;
      if (typeof pipeline !== "function") {
        throw new Error("Rampart backend did not expose a pipeline function");
      }

      try {
        return await pipeline("token-classification", RAMPART_MODEL, { aggregation_strategy: "simple" });
      } catch {
        return await pipeline("token-classification", RAMPART_MODEL);
      }
    })();
  }

  return pipelinePromise;
}

export async function rampartAvailable(): Promise<boolean> {
  try {
    await getRampart();
    return true;
  } catch {
    return false;
  }
}

export async function redactPii(text: string): Promise<string> {
  try {
    const classifier = await getRampartPipeline();
    const chunks = splitForPii(text);
    const placeholders = new Map<string, string>();
    let redacted = "";

    for (const chunk of chunks) {
      redacted += await redactPiiChunk(classifier, chunk, placeholders);
    }

    return redacted;
  } catch {
    return text;
  }
}

export async function redactText(text: string, opts?: RedactTextOptions): Promise<string> {
  return (await redactTextWithReport(text, opts)).text;
}

export async function redactTextWithReport(
  text: string,
  opts?: RedactTextOptions,
): Promise<{ text: string; layers: RedactionLayerReport[] }> {
  const options = applyRedactionDefaults(opts);
  const piiAvailable = options.pii ? await rampartAvailable() : false;
  const layers: RedactionLayerReport[] = [];
  let current = text;

  if (options.pii && piiAvailable) {
    const before = current;
    current = await redactPii(current);
    layers.push({ layer: "pii", applied: true, changed: before !== current });
  } else {
    layers.push({ layer: "pii", applied: false, changed: false });
  }

  if (options.secrets) {
    const before = current;
    current = redactSecrets(current);
    layers.push({ layer: "secrets", applied: true, changed: before !== current });
  } else {
    layers.push({ layer: "secrets", applied: false, changed: false });
  }

  if (options.paths) {
    const before = current;
    current = redactSensitiveText(current);
    layers.push({ layer: "paths", applied: true, changed: before !== current });
  } else {
    layers.push({ layer: "paths", applied: false, changed: false });
  }

  return { text: current, layers };
}

function applyRedactionDefaults(opts?: RedactTextOptions): Required<RedactTextOptions> {
  return {
    paths: opts?.paths ?? true,
    secrets: opts?.secrets ?? true,
    pii: opts?.pii ?? false,
  };
}

async function redactPiiChunk(
  classifier: any,
  chunk: string,
  placeholders: Map<string, string>,
): Promise<string> {
  const result = await classifier(chunk);
  const spans = aggregateEntitySpans(result);
  const offsetSpans = spans.filter((span) => hasOffsets(span));

  if (offsetSpans.length > 0) {
    return replaceOffsetSpans(chunk, offsetSpans, placeholders);
  }

  return replaceStringSpans(chunk, spans, placeholders);
}

function splitForPii(text: string): string[] {
  if (text.length <= MAX_PII_CHUNK_LENGTH) return [text];

  const chunks: string[] = [];
  let index = 0;

  while (index < text.length) {
    let end = Math.min(index + MAX_PII_CHUNK_LENGTH, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf(" ", end);
      if (boundary > index) end = boundary + 1;
    }

    chunks.push(text.slice(index, end));
    index = end;
  }

  return chunks;
}

function aggregateEntitySpans(result: unknown): EntitySpan[] {
  if (!Array.isArray(result)) return [];

  const spans: EntitySpan[] = [];
  let current: EntitySpan | null = null;

  for (const item of result) {
    if (!isRecord(item)) continue;

    const rawType = String(item.entity_group ?? item.entity ?? "");
    const type = normalizeEntityType(rawType);
    const prefix = rawType.startsWith("I-") ? "I" : rawType.startsWith("B-") ? "B" : "";
    const word = String(item.word ?? "");
    if (!type || !word) continue;

    const span: EntitySpan = {
      type,
      word,
      start: typeof item.start === "number" ? item.start : undefined,
      end: typeof item.end === "number" ? item.end : undefined,
    };

    if (!current || prefix === "B" || current.type !== span.type || !canMergeSpans(current, span)) {
      if (current) spans.push(current);
      current = span;
      continue;
    }

    current = mergeSpans(current, span);
  }

  if (current) spans.push(current);
  return spans;
}

function normalizeEntityType(value: string): string {
  return value.replace(/^[BI]-/, "").toUpperCase();
}

function canMergeSpans(left: EntitySpan, right: EntitySpan): boolean {
  if (hasOffsets(left) && hasOffsets(right)) {
    return right.start <= left.end + 1;
  }

  return true;
}

function mergeSpans(left: EntitySpan, right: EntitySpan): EntitySpan {
  return {
    type: left.type,
    word: mergeWords(left.word, right.word),
    start: left.start,
    end: typeof right.end === "number" ? right.end : left.end,
  };
}

function mergeWords(left: string, right: string): string {
  if (right.startsWith("##")) return `${left}${right.slice(2)}`;
  if (left.endsWith(" ") || /^[.,;:!?)]/.test(right)) return `${left}${right}`;
  return `${left} ${right}`;
}

function replaceOffsetSpans(
  text: string,
  spans: Array<EntitySpan & { start: number; end: number }>,
  placeholders: Map<string, string>,
): string {
  let output = text;
  let lastStart = text.length + 1;
  const sorted = [...spans].sort((left, right) => right.start - left.start);

  for (const span of sorted) {
    const start = span.start;
    const end = span.end;
    if (start < 0 || end > text.length || start >= end || end > lastStart) continue;

    const matchedText = text.slice(start, end);
    const placeholder = placeholderFor(span.type, matchedText, placeholders);
    output = `${output.slice(0, start)}${placeholder}${output.slice(end)}`;
    lastStart = start;
  }

  return output;
}

function replaceStringSpans(
  text: string,
  spans: EntitySpan[],
  placeholders: Map<string, string>,
): string {
  let output = text;

  for (const span of spans) {
    if (!span.word) continue;
    const placeholder = placeholderFor(span.type, span.word, placeholders);
    output = output.split(span.word).join(placeholder);
  }

  return output;
}

function placeholderFor(type: string, matchedText: string, placeholders: Map<string, string>): string {
  const existing = placeholders.get(matchedText);
  if (existing) return existing;

  const placeholder = `[${type}_${placeholders.size + 1}]`;
  placeholders.set(matchedText, placeholder);
  return placeholder;
}

function hasOffsets(span: EntitySpan): span is EntitySpan & { start: number; end: number } {
  return typeof span.start === "number" && typeof span.end === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
