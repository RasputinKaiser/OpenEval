import type { EvidencePacket, EvidenceRecord } from "./evidence";

export type UnknownCause =
  | "bounded_omission"
  | "unsupported_format"
  | "unsupported_records"
  | "missing_output"
  | "malformed_data"
  | "absent_verification"
  | "unavailable_source";

export interface UnknownAction {
  id: string;
  cause: UnknownCause;
  title: string;
  explanation: string;
  nextAction: string;
  evidenceIds: string[];
  evidenceCount: number;
  limitSummary?: string;
  transcriptHref?: string;
}

export interface BuildUnknownActionsOptions {
  sourceId?: string;
  sessionId?: string;
  /** A transport/source error is distinct from an in-packet unknown. */
  unavailableReason?: string;
  maxActions?: number;
  maxEvidenceIds?: number;
}

const DEFAULT_MAX_ACTIONS = 8;
const DEFAULT_MAX_EVIDENCE_IDS = 3;
const CONTROLLED_UNAVAILABLE_REASONS = [
  "Only the archived summary remains; transcript evidence is unavailable.",
  "This transcript changed while evidence was read. Refresh the packet.",
  "The evidence source could not be read. Refresh the collection and try again.",
  "This session is not in the current collection inventory.",
  "A valid source and session identity are required.",
] as const;

/** Keep endpoint detail useful while avoiding arbitrary transport/path text. */
export function formatUnavailableReason(reason: string | undefined): string {
  const normalized = reason?.replace(/\s+/g, " ").trim();
  return normalized && CONTROLLED_UNAVAILABLE_REASONS.includes(normalized as typeof CONTROLLED_UNAVAILABLE_REASONS[number])
    ? normalized
    : "The evidence endpoint did not return a bounded packet.";
}

function boundedInteger(value: number | undefined, fallback: number, maximum: number): number {
  return Math.min(maximum, Math.max(1, Number.isFinite(value) ? Math.floor(value as number) : fallback));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function transcriptHref(sourceId: string | undefined, sessionId: string | undefined): string | undefined {
  if (!sourceId || !sessionId) return undefined;
  const params = new URLSearchParams({ sourceId, sessionId });
  return `/collection/session?${params.toString()}`;
}

function refs(records: EvidenceRecord[], predicate: (record: EvidenceRecord) => boolean, max: number): { evidenceIds: string[]; evidenceCount: number } {
  const all = unique(records.filter(predicate).map((record) => record.evidenceId));
  return { evidenceIds: all.slice(0, max), evidenceCount: all.length };
}

function action(
  value: Omit<UnknownAction, "evidenceIds" | "evidenceCount">,
  records: EvidenceRecord[],
  predicate: (record: EvidenceRecord) => boolean,
  maxEvidenceIds: number,
): UnknownAction {
  const references = refs(records, predicate, maxEvidenceIds);
  return { ...value, ...references };
}

/**
 * Convert packet boundaries into a compact cause/action view. The adapter is
 * deliberately source-observing: it never retries reads, parses new formats,
 * or treats a suggested action as evidence that recovery is possible.
 */
export function buildUnknownActions(packet: EvidencePacket | null | undefined, options: BuildUnknownActionsOptions = {}): UnknownAction[] {
  const maxActions = boundedInteger(options.maxActions, DEFAULT_MAX_ACTIONS, 12);
  const maxEvidenceIds = boundedInteger(options.maxEvidenceIds, DEFAULT_MAX_EVIDENCE_IDS, 12);
  const actions: UnknownAction[] = [];
  const records = packet?.records ?? [];
  const sourceId = packet?.sourceId ?? options.sourceId;
  const sessionId = packet?.sessionId ?? options.sessionId;
  const canOpenTranscript = Boolean(packet && !packet.records.some((record) => record.type === "read_error"));
  const sourceLink = canOpenTranscript ? transcriptHref(sourceId, sessionId) : undefined;
  const add = (value: Omit<UnknownAction, "evidenceIds" | "evidenceCount">, predicate: (record: EvidenceRecord) => boolean) => {
    if (actions.length < maxActions) actions.push(action(value, records, predicate, maxEvidenceIds));
  };

  if (!packet) {
    if (options.unavailableReason) {
      const reason = formatUnavailableReason(options.unavailableReason);
      actions.push({
        id: "unavailable-source",
        cause: "unavailable_source",
        title: "Evidence source unavailable",
        explanation: `${reason} No bounded packet is available for this view, so the cause cannot be inferred from session records.`,
        nextAction: "Refresh the packet or inspect the source inventory; this state does not classify the source as permanently unavailable and no broader read is attempted.",
        evidenceIds: [],
        evidenceCount: 0,
      });
    }
    return actions;
  }

  if (packet.bounds.truncated || packet.bounds.omittedRecords > 0) {
    add({
      id: "bounded-omission",
      cause: "bounded_omission",
      title: "Evidence window is bounded",
      explanation: "Some source records were omitted or the byte window stopped early, so this view cannot establish a complete session picture.",
      nextAction: "Use the retained citations to inspect what was observed; continue from the existing transcript only if the source remains available.",
      limitSummary: `Retained ${packet.bounds.recordsRetained} source records observed within the bounded read; read ${packet.bounds.bytesRead} of at most ${packet.bounds.maxBytes} bytes.`,
      transcriptHref: sourceLink,
    }, (record) => record.truncated === true);
  }

  if (packet.format === "unsupported") {
    add({
      id: "unsupported-format",
      cause: "unsupported_format",
      title: "Source format is unsupported",
      explanation: "The source inventory identifies this format, but the evidence adapter cannot normalize it into session records.",
      nextAction: "Inspect Collection source inventory for a supported transcript; this brief cannot infer intent or recovery from the unsupported source.",
      limitSummary: `Format: ${packet.format}; retained ${packet.bounds.recordsRetained} record${packet.bounds.recordsRetained === 1 ? "" : "s"}.`,
      transcriptHref: sourceLink,
    }, (record) => record.unsupported === true);
  } else if (packet.records.some((record) => record.unsupported === true) || packet.bounds.unsupported) {
    add({
      id: "unsupported-records",
      cause: "unsupported_records",
      title: "Some records have unsupported shapes",
      explanation: "Known records remain inspectable, but unsupported records cannot be treated as observed intent, output, or verification.",
      nextAction: "Inspect the retained supported excerpts and source transcript; do not treat omitted shapes as successful or recovered.",
      limitSummary: `Retained ${packet.records.filter((record) => record.unsupported === true).length} unsupported record${packet.records.filter((record) => record.unsupported === true).length === 1 ? "" : "s"}.`,
      transcriptHref: sourceLink,
    }, (record) => record.unsupported === true);
  }

  if (packet.records.some((record) => record.missingOutput === true)) {
    add({
      id: "missing-output",
      cause: "missing_output",
      title: "A tool output is missing",
      explanation: "A retained tool receipt lacks output, so its result and any downstream recovery remain unknown.",
      nextAction: "Open the cited record or transcript to check whether the source preserves the output; do not reconstruct it from assistant prose.",
      limitSummary: `${packet.records.filter((record) => record.missingOutput === true).length} retained record${packet.records.filter((record) => record.missingOutput === true).length === 1 ? "" : "s"} lacks output.`,
      transcriptHref: sourceLink,
    }, (record) => record.missingOutput === true);
  }

  if (packet.bounds.malformedRecords > 0 || packet.records.some((record) => record.tags.includes("malformed") || record.type === "malformed_record")) {
    add({
      id: "malformed-data",
      cause: "malformed_data",
      title: "Malformed source data was retained",
      explanation: "Malformed records are kept as unknown diagnostics and cannot support a claim about intent, output, or success.",
      nextAction: "Inspect the cited diagnostic and the remaining retained records; repair or re-export the source before relying on omitted content.",
      limitSummary: `${packet.bounds.malformedRecords} malformed source record${packet.bounds.malformedRecords === 1 ? "" : "s"} reported.`,
      transcriptHref: sourceLink,
    }, (record) => record.tags.includes("malformed") || record.type === "malformed_record");
  }

  if (packet.evaluation.verification.status === "unknown") {
    add({
      id: "absent-verification",
      cause: "absent_verification",
      title: "Verification is unknown",
      explanation: "No observed receipt establishes a verification result; assistant statements about tests or correctness are claims, not checks.",
      nextAction: "Inspect the retained tool evidence or open the transcript if available; run or record a verification only in the owning workflow.",
      limitSummary: `Verification evidence IDs retained: ${packet.evaluation.verification.evidenceIds.length}.`,
      transcriptHref: sourceLink,
    }, (record) => record.kind === "tool_result" || record.kind === "error");
  }

  return actions.slice(0, maxActions);
}
