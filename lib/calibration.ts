import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "./db";

export const CALIBRATION_REFERENCE_PROVENANCES = ["human", "synthetic", "imported"] as const;
export const CALIBRATION_OBSERVATION_PROVENANCES = ["synthetic", "imported"] as const;
export const CALIBRATION_OUTCOMES = ["achieved", "partial", "not_achieved", "insufficient_evidence"] as const;

export type CalibrationReferenceProvenance = typeof CALIBRATION_REFERENCE_PROVENANCES[number];
export type CalibrationObservationProvenance = typeof CALIBRATION_OBSERVATION_PROVENANCES[number];
export type CalibrationOutcome = typeof CALIBRATION_OUTCOMES[number];

export interface CalibrationReferenceInput {
  referenceId?: string;
  label: string;
  authorLabel: string;
  provenance: CalibrationReferenceProvenance;
  humanAttestation?: boolean;
  sourceId: string;
  sessionId: string;
  evidenceDigest: string;
  evidenceVersion: string;
  rubric: string;
  outcome: CalibrationOutcome;
  rationale: string;
  citedEvidenceIds: string[];
  createdAt?: number;
}

export interface CalibrationReference extends Omit<CalibrationReferenceInput, "referenceId" | "createdAt" | "humanAttestation"> {
  referenceId: string;
  version: number;
  createdAt: number;
}

export interface CalibrationObservationInput {
  recordId: string;
  referenceId: string;
  referenceVersion: number;
  provenance: CalibrationObservationProvenance;
  sourceId: string;
  sessionId: string;
  evidenceDigest: string;
  evidenceVersion: string;
  rubric: string;
  outcome: CalibrationOutcome;
  citedEvidenceIds: string[];
  evidenceInventoryIds?: string[] | null;
  backend: string;
  model: string;
  reasoningEffort: string;
  promptVersion: number;
  costUsd?: number | null;
  elapsedMs?: number | null;
  createdAt?: number;
}

export interface CalibrationObservation extends Omit<CalibrationObservationInput, "createdAt"> {
  createdAt: number;
}

export interface CalibrationMethodReport {
  methodKey: string;
  backend: string;
  model: string;
  reasoningEffort: string;
  promptVersion: number;
  matchedJudgments: number;
  humanMatchedJudgments: number;
  syntheticMatchedJudgments: number;
  importedMatchedJudgments: number;
  agreementNumerator: number;
  agreementDenominator: number;
  agreementRate: number | null;
  falseSuccessNumerator: number;
  falseSuccessDenominator: number;
  falseSuccessRate: number | null;
  abstentionNumerator: number;
  abstentionDenominator: number;
  abstentionRate: number | null;
  citationValidNumerator: number;
  citationDenominator: number;
  citationUnknownJudgments: number;
  citationValidityRate: number | null;
  repeatabilityStablePairs: number;
  repeatabilityPairs: number;
  repeatabilityRate: number | null;
  costUsdTotal: number;
  costUsdCount: number;
  elapsedMsTotal: number;
  elapsedMsCount: number;
  unmatchedObservations: number;
}

export interface CalibrationReport {
  generatedAt: number;
  references: { total: number; human: number; synthetic: number; imported: number };
  observations: { total: number; matched: number; unmatched: number; humanMatched: number; syntheticMatched: number; importedMatched: number };
  methods: CalibrationMethodReport[];
  note: string;
}

const MAX_BATCH = 200;
const MAX_ID = 240;
const MAX_TEXT = 4_000;
const MAX_RUBRIC = 1_000;

function dbOrDefault(conn?: Database.Database): Database.Database { return conn ?? getDb(); }
function cleanText(value: unknown, label: string, max = MAX_TEXT): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) throw new Error(`${label} must be a non-empty bounded string.`);
  return value.trim();
}
function boundedId(value: unknown, label: string): string { return cleanText(value, label, MAX_ID); }
function finiteNonNegative(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be null or a finite non-negative number.`);
  return value;
}
function integer(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}
function enumValue<T extends readonly string[]>(value: unknown, values: T, label: string): T[number] {
  if (typeof value !== "string" || !values.includes(value)) throw new Error(`${label} is invalid.`);
  return value as T[number];
}
function uniqueIds(values: unknown, label: string): string[] {
  if (!Array.isArray(values) || values.length > 200) throw new Error(`${label} must be a bounded array.`);
  const result = values.map((value) => boundedId(value, `${label} item`));
  if (new Set(result).size !== result.length) throw new Error(`${label} cannot contain duplicate IDs.`);
  return result;
}
function exactIdentity(input: { sourceId: unknown; sessionId: unknown; evidenceDigest: unknown; evidenceVersion: unknown; rubric: unknown }) {
  return {
    sourceId: boundedId(input.sourceId, "sourceId"),
    sessionId: boundedId(input.sessionId, "sessionId"),
    evidenceDigest: boundedId(input.evidenceDigest, "evidenceDigest"),
    evidenceVersion: boundedId(input.evidenceVersion, "evidenceVersion"),
    rubric: cleanText(input.rubric, "rubric", MAX_RUBRIC),
  };
}

function normalizeReference(input: CalibrationReferenceInput): CalibrationReferenceInput & { referenceId: string; createdAt: number } {
  const provenance = enumValue(input.provenance, CALIBRATION_REFERENCE_PROVENANCES, "provenance");
  if (provenance === "human" && input.humanAttestation !== true) throw new Error("Human references require an explicit attestation.");
  const identity = exactIdentity(input);
  return {
    referenceId: input.referenceId === undefined ? randomUUID() : boundedId(input.referenceId, "referenceId"),
    label: cleanText(input.label, "label", 240),
    authorLabel: cleanText(input.authorLabel, "authorLabel", 240),
    provenance,
    humanAttestation: provenance === "human",
    ...identity,
    outcome: enumValue(input.outcome, CALIBRATION_OUTCOMES, "outcome"),
    rationale: cleanText(input.rationale, "rationale"),
    citedEvidenceIds: uniqueIds(input.citedEvidenceIds, "citedEvidenceIds"),
    createdAt: input.createdAt === undefined ? Date.now() : integer(input.createdAt, "createdAt"),
  };
}

function normalizeObservation(input: CalibrationObservationInput): CalibrationObservation {
  const provenance = enumValue(input.provenance, CALIBRATION_OBSERVATION_PROVENANCES, "provenance");
  const identity = exactIdentity(input);
  return {
    recordId: boundedId(input.recordId, "recordId"),
    referenceId: boundedId(input.referenceId, "referenceId"),
    referenceVersion: integer(input.referenceVersion, "referenceVersion"),
    provenance,
    ...identity,
    outcome: enumValue(input.outcome, CALIBRATION_OUTCOMES, "outcome"),
    citedEvidenceIds: uniqueIds(input.citedEvidenceIds, "citedEvidenceIds"),
    evidenceInventoryIds: input.evidenceInventoryIds === null || input.evidenceInventoryIds === undefined ? null : uniqueIds(input.evidenceInventoryIds, "evidenceInventoryIds"),
    backend: cleanText(input.backend, "backend", 240),
    model: cleanText(input.model, "model", 240),
    reasoningEffort: cleanText(input.reasoningEffort, "reasoningEffort", 120),
    promptVersion: integer(input.promptVersion, "promptVersion"),
    costUsd: finiteNonNegative(input.costUsd, "costUsd"),
    elapsedMs: finiteNonNegative(input.elapsedMs, "elapsedMs"),
    createdAt: input.createdAt === undefined ? Date.now() : integer(input.createdAt, "createdAt"),
  };
}

function referenceFromRow(row: any): CalibrationReference {
  return { referenceId: row.reference_id, version: Number(row.version), label: row.label, authorLabel: row.author_label, provenance: row.provenance, sourceId: row.source_id, sessionId: row.session_id, evidenceDigest: row.evidence_digest, evidenceVersion: row.evidence_version, rubric: row.rubric, outcome: row.outcome, rationale: row.rationale, citedEvidenceIds: JSON.parse(row.cited_ids_json), createdAt: Number(row.created_at) };
}
function observationFromRow(row: any): CalibrationObservation {
  return { recordId: row.record_id, referenceId: row.reference_id, referenceVersion: Number(row.reference_version), provenance: row.provenance, sourceId: row.source_id, sessionId: row.session_id, evidenceDigest: row.evidence_digest, evidenceVersion: row.evidence_version, rubric: row.rubric, outcome: row.outcome, citedEvidenceIds: JSON.parse(row.cited_ids_json), evidenceInventoryIds: row.inventory_ids_json ? JSON.parse(row.inventory_ids_json) : null, backend: row.backend, model: row.model, reasoningEffort: row.reasoning_effort, promptVersion: Number(row.prompt_version), costUsd: row.cost_usd === null ? null : Number(row.cost_usd), elapsedMs: row.elapsed_ms === null ? null : Number(row.elapsed_ms), createdAt: Number(row.created_at) };
}
function referencePayload(reference: CalibrationReferenceInput & { referenceId: string; createdAt: number }): string {
  const { createdAt: _createdAt, ...payload } = reference;
  return JSON.stringify(payload);
}
function observationPayload(observation: CalibrationObservation): string {
  const { createdAt: _createdAt, ...payload } = observation;
  return JSON.stringify(payload);
}

export function createCalibrationReference(input: CalibrationReferenceInput, conn?: Database.Database): CalibrationReference {
  const db = dbOrDefault(conn);
  const normalized = normalizeReference(input);
  const version = Number(db.prepare("SELECT COALESCE(MAX(version), 0) + 1 FROM calibration_references WHERE reference_id = ?").pluck().get(normalized.referenceId) ?? 1);
  const result: CalibrationReference = { ...normalized, version };
  db.prepare(`INSERT INTO calibration_references (reference_id, version, label, author_label, provenance, source_id, session_id, evidence_digest, evidence_version, rubric, outcome, rationale, cited_ids_json, created_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(result.referenceId, result.version, result.label, result.authorLabel, result.provenance, result.sourceId, result.sessionId, result.evidenceDigest, result.evidenceVersion, result.rubric, result.outcome, result.rationale, JSON.stringify(result.citedEvidenceIds), result.createdAt, referencePayload(result));
  return result;
}

export function listCalibrationReferences(conn?: Database.Database): CalibrationReference[] {
  return (dbOrDefault(conn).prepare("SELECT * FROM calibration_references ORDER BY created_at DESC, reference_id ASC, version DESC").all() as any[]).map(referenceFromRow);
}

export function importCalibrationObservations(inputs: CalibrationObservationInput[], conn?: Database.Database): { inserted: number; unchanged: number } {
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > MAX_BATCH) throw new Error(`observations must contain 1 to ${MAX_BATCH} records.`);
  const normalized = inputs.map(normalizeObservation);
  const byId = new Map<string, CalibrationObservation>();
  for (const item of normalized) {
    const previous = byId.get(item.recordId);
    if (previous && observationPayload(previous) !== observationPayload(item)) throw new Error(`Duplicate recordId ${item.recordId} has differing payloads.`);
    byId.set(item.recordId, item);
  }
  const db = dbOrDefault(conn);
  let inserted = 0, unchanged = 0;
  const write = db.transaction(() => {
    const existing = db.prepare("SELECT payload_json FROM calibration_observations WHERE record_id = ?");
    const insert = db.prepare(`INSERT INTO calibration_observations (record_id, reference_id, reference_version, provenance, source_id, session_id, evidence_digest, evidence_version, rubric, outcome, cited_ids_json, inventory_ids_json, backend, model, reasoning_effort, prompt_version, cost_usd, elapsed_ms, created_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const item of byId.values()) {
      const row = existing.get(item.recordId) as { payload_json?: string } | undefined;
      const payload = observationPayload(item);
      if (row) {
        if (row.payload_json !== payload) throw new Error(`Record ${item.recordId} already exists with a different payload.`);
        unchanged++;
        continue;
      }
      insert.run(item.recordId, item.referenceId, item.referenceVersion, item.provenance, item.sourceId, item.sessionId, item.evidenceDigest, item.evidenceVersion, item.rubric, item.outcome, JSON.stringify(item.citedEvidenceIds), item.evidenceInventoryIds ? JSON.stringify(item.evidenceInventoryIds) : null, item.backend, item.model, item.reasoningEffort, item.promptVersion, item.costUsd, item.elapsedMs, item.createdAt, payload);
      inserted++;
    }
  });
  write();
  return { inserted, unchanged };
}

export function listCalibrationObservations(conn?: Database.Database): CalibrationObservation[] {
  return (dbOrDefault(conn).prepare("SELECT * FROM calibration_observations ORDER BY created_at ASC, record_id ASC").all() as any[]).map(observationFromRow);
}

function rate(numerator: number, denominator: number): number | null { return denominator > 0 ? numerator / denominator : null; }
function methodKey(item: CalibrationObservation): string { return `${item.backend}\u0000${item.model}\u0000${item.reasoningEffort}\u0000${item.promptVersion}`; }
function sameEvidence(a: CalibrationObservation, b: CalibrationReference): boolean {
  return a.sourceId === b.sourceId && a.sessionId === b.sessionId && a.evidenceDigest === b.evidenceDigest && a.evidenceVersion === b.evidenceVersion && a.rubric === b.rubric;
}

export function buildCalibrationReport(conn?: Database.Database): CalibrationReport {
  const references = listCalibrationReferences(conn);
  const observations = listCalibrationObservations(conn);
  const referenceMap = new Map(references.map((reference) => [`${reference.referenceId}\u0000${reference.version}`, reference]));
  const groups = new Map<string, CalibrationMethodReport & { observations: Array<{ observation: CalibrationObservation; reference: CalibrationReference }> }>();
  let unmatched = 0;
  for (const observation of observations) {
    const reference = referenceMap.get(`${observation.referenceId}\u0000${observation.referenceVersion}`);
    if (!reference || !sameEvidence(observation, reference)) {
      unmatched++;
      const key = methodKey(observation);
      const group = groups.get(key);
      if (group) group.unmatchedObservations++;
      else groups.set(key, { methodKey: key, backend: observation.backend, model: observation.model, reasoningEffort: observation.reasoningEffort, promptVersion: observation.promptVersion, matchedJudgments: 0, humanMatchedJudgments: 0, syntheticMatchedJudgments: 0, importedMatchedJudgments: 0, agreementNumerator: 0, agreementDenominator: 0, agreementRate: null, falseSuccessNumerator: 0, falseSuccessDenominator: 0, falseSuccessRate: null, abstentionNumerator: 0, abstentionDenominator: 0, abstentionRate: null, citationValidNumerator: 0, citationDenominator: 0, citationUnknownJudgments: 0, citationValidityRate: null, repeatabilityStablePairs: 0, repeatabilityPairs: 0, repeatabilityRate: null, costUsdTotal: 0, costUsdCount: 0, elapsedMsTotal: 0, elapsedMsCount: 0, unmatchedObservations: 1, observations: [] });
      continue;
    }
    const key = methodKey(observation);
    const group = groups.get(key) ?? { methodKey: key, backend: observation.backend, model: observation.model, reasoningEffort: observation.reasoningEffort, promptVersion: observation.promptVersion, matchedJudgments: 0, humanMatchedJudgments: 0, syntheticMatchedJudgments: 0, importedMatchedJudgments: 0, agreementNumerator: 0, agreementDenominator: 0, agreementRate: null, falseSuccessNumerator: 0, falseSuccessDenominator: 0, falseSuccessRate: null, abstentionNumerator: 0, abstentionDenominator: 0, abstentionRate: null, citationValidNumerator: 0, citationDenominator: 0, citationUnknownJudgments: 0, citationValidityRate: null, repeatabilityStablePairs: 0, repeatabilityPairs: 0, repeatabilityRate: null, costUsdTotal: 0, costUsdCount: 0, elapsedMsTotal: 0, elapsedMsCount: 0, unmatchedObservations: 0, observations: [] };
    group.matchedJudgments++;
    if (reference.provenance === "human" && observation.provenance !== "synthetic") group.humanMatchedJudgments++;
    if (reference.provenance === "synthetic" || observation.provenance === "synthetic") group.syntheticMatchedJudgments++;
    if (reference.provenance === "imported" || observation.provenance === "imported") group.importedMatchedJudgments++;
    group.observations.push({ observation, reference });
    if (typeof observation.costUsd === "number") { group.costUsdTotal += observation.costUsd; group.costUsdCount++; }
    if (typeof observation.elapsedMs === "number") { group.elapsedMsTotal += observation.elapsedMs; group.elapsedMsCount++; }
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const human = group.observations.filter(({ observation, reference }) => reference.provenance === "human" && observation.provenance !== "synthetic");
    group.agreementDenominator = human.length;
    group.agreementNumerator = human.filter(({ observation, reference }) => observation.outcome === reference.outcome).length;
    const achieved = human.filter(({ observation, reference }) => observation.outcome === "achieved" && reference.outcome !== "insufficient_evidence");
    group.falseSuccessDenominator = achieved.length;
    group.falseSuccessNumerator = achieved.filter(({ reference }) => reference.outcome !== "achieved").length;
    group.abstentionDenominator = human.length;
    group.abstentionNumerator = human.filter(({ observation }) => observation.outcome === "insufficient_evidence").length;
    for (const { observation } of human) {
      if (observation.citedEvidenceIds.length === 0) continue;
      if (!observation.evidenceInventoryIds) { group.citationUnknownJudgments++; continue; }
      const inventory = new Set(observation.evidenceInventoryIds);
      group.citationDenominator += observation.citedEvidenceIds.length;
      group.citationValidNumerator += observation.citedEvidenceIds.filter((id) => inventory.has(id)).length;
    }
    const byReference = new Map<string, CalibrationObservation[]>();
    for (const { observation, reference } of human) { const key = `${reference.referenceId}\u0000${reference.version}`; const list = byReference.get(key) ?? []; list.push(observation); byReference.set(key, list); }
    for (const list of byReference.values()) {
      list.sort((a, b) => a.createdAt - b.createdAt || a.recordId.localeCompare(b.recordId));
      for (let i = 1; i < list.length; i++) { group.repeatabilityPairs++; if (list[i].outcome === list[i - 1].outcome) group.repeatabilityStablePairs++; }
    }
    group.agreementRate = rate(group.agreementNumerator, group.agreementDenominator);
    group.falseSuccessRate = rate(group.falseSuccessNumerator, group.falseSuccessDenominator);
    group.abstentionRate = rate(group.abstentionNumerator, group.abstentionDenominator);
    group.citationValidityRate = rate(group.citationValidNumerator, group.citationDenominator);
    group.repeatabilityRate = rate(group.repeatabilityStablePairs, group.repeatabilityPairs);
    delete (group as Partial<typeof group>).observations;
  }
  return {
    generatedAt: Date.now(),
    references: { total: references.length, human: references.filter((r) => r.provenance === "human").length, synthetic: references.filter((r) => r.provenance === "synthetic").length, imported: references.filter((r) => r.provenance === "imported").length },
    observations: { total: observations.length, matched: observations.length - unmatched, unmatched, humanMatched: [...groups.values()].reduce((n, group) => n + group.humanMatchedJudgments, 0), syntheticMatched: [...groups.values()].reduce((n, group) => n + group.syntheticMatchedJudgments, 0), importedMatched: [...groups.values()].reduce((n, group) => n + group.importedMatchedJudgments, 0) },
    methods: [...groups.values()].map(({ observations: _observations, ...report }) => report).sort((a, b) => a.methodKey.localeCompare(b.methodKey)),
    note: "Rates use exact identity, evidence digest/version, and rubric matches. Human denominators exclude synthetic observations and nonhuman references; imported observations remain labeled as imported. Missing evidence inventories remain unknown.",
  };
}
