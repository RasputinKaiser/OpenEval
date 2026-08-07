import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HARNESS_DESC_DIR } from "../config";
import { BUILTIN_DESCRIPTORS } from "./builtin";
import { invalidateDescriptorCache } from "./loader";
import { invalidateRegistry } from "./registry";
import { validateDescriptor, type DescriptorIssue, type NormalizedDescriptor } from "./schema";
import type { DiscoveredHarness } from "./discover";

export type RegistrationProvenance = "user-managed" | "user-override" | "bundled-reference";
export type ReadinessState = "ready" | "partial" | "unavailable" | "unknown";
export type ReadinessLayerId = "registration" | "binary" | "execution" | "observation" | "judge";

export interface ReadinessLayer {
  id: ReadinessLayerId;
  label: string;
  state: ReadinessState;
  summary: string;
  diagnostic: string;
  action: string;
}

export interface HarnessRegistration {
  provenance: RegistrationProvenance;
  enabled: boolean;
  revision: string | null;
  file: string | null;
}

export interface RegisteredDescriptor {
  descriptor: NormalizedDescriptor;
  registration: HarnessRegistration;
}

export class DescriptorConflictError extends Error {
  constructor(public readonly currentRevision: string) {
    super("This descriptor changed in another browser tab. Review the current version before replacing it.");
    this.name = "DescriptorConflictError";
  }
}

export class DescriptorMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DescriptorMutationError";
  }
}

const BUILTIN_IDS = new Set(BUILTIN_DESCRIPTORS.flatMap((descriptor) => typeof descriptor.id === "string" ? [descriptor.id] : []));

function descriptorFile(id: string): string {
  return path.join(HARNESS_DESC_DIR, `${id}.harness.json`);
}

function safeDescriptorFile(id: string): string {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) throw new DescriptorMutationError("Descriptor id must contain only letters, numbers, dots, underscores, or hyphens.");
  const base = path.resolve(HARNESS_DESC_DIR);
  const file = path.resolve(descriptorFile(id));
  const relative = path.relative(base, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || relative !== `${id}.harness.json`) {
    throw new DescriptorMutationError("Descriptor path is outside the managed harness directory.");
  }
  return file;
}

function ensureManagedDirectory(): void {
  fs.mkdirSync(HARNESS_DESC_DIR, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(HARNESS_DESC_DIR);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new DescriptorMutationError("The managed harness directory is not a regular directory.");
  }
}

function assertRegularTarget(file: string): void {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new DescriptorMutationError("Refusing to modify a symlink or non-file descriptor target.");
  } catch (error) {
    if (error instanceof DescriptorMutationError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function revisionFor(bytes: string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function readRevision(file: string): string | null {
  try {
    return revisionFor(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function registrationFor(id: string, revision: string | null = null): HarnessRegistration {
  if (!BUILTIN_IDS.has(id)) {
    return { provenance: "user-managed", enabled: true, revision, file: revision ? descriptorFile(id) : null };
  }
  return revision
    ? { provenance: "user-override", enabled: true, revision, file: descriptorFile(id) }
    : { provenance: "bundled-reference", enabled: true, revision: null, file: null };
}

export function getHarnessRegistration(id: string): HarnessRegistration {
  const file = safeDescriptorFile(id);
  ensureManagedDirectory();
  let revision: string | null = null;
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) return registrationFor(id);
    revision = readRevision(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return registrationFor(id, revision);
}

export function getRegistrationRecords(): Record<string, HarnessRegistration> {
  ensureManagedDirectory();
  const records: Record<string, HarnessRegistration> = {};
  for (const raw of BUILTIN_DESCRIPTORS) {
    if (typeof raw.id === "string") records[raw.id] = getHarnessRegistration(raw.id);
  }
  for (const entry of fs.readdirSync(HARNESS_DESC_DIR)) {
    if (!entry.endsWith(".harness.json")) continue;
    const id = entry.slice(0, -".harness.json".length);
    try {
      const file = safeDescriptorFile(id);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile()) continue;
      records[id] = registrationFor(id, readRevision(file));
    } catch {
      // Invalid filenames and symlinks are reported by the loader's descriptor
      // issue surface; they must not make the connection center unavailable.
    }
  }
  return records;
}

export function registerDescriptor(rawInput: unknown, expectedRevision?: string): RegisteredDescriptor {
  const raw = typeof rawInput === "string" ? parseDescriptorText(rawInput) : rawInput;
  const validation = validateDescriptor(raw, "connection-center");
  if (!validation.descriptor) throw new DescriptorMutationError(formatIssues(validation.issues));
  const descriptor = validation.descriptor;
  const file = safeDescriptorFile(descriptor.id);
  ensureManagedDirectory();
  assertRegularTarget(file);
  const currentRevision = readRevision(file);
  if (expectedRevision && currentRevision !== expectedRevision) throw new DescriptorConflictError(currentRevision ?? "missing");

  const content = `${JSON.stringify(raw, null, 2)}\n`;
  const temp = path.join(HARNESS_DESC_DIR, `.tmp-${descriptor.id}-${process.pid}-${crypto.randomBytes(6).toString("hex")}.harness.json`);
  try {
    fs.writeFileSync(temp, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    try { fs.unlinkSync(temp); } catch {}
  }
  invalidateDescriptorCache();
  invalidateRegistry();
  return { descriptor, registration: registrationFor(descriptor.id, revisionFor(content)) };
}

export function disconnectDescriptor(id: string, expectedRevision?: string): { removed: boolean; fallback: RegistrationProvenance } {
  const file = safeDescriptorFile(id);
  ensureManagedDirectory();
  const currentRevision = readRevision(file);
  if (expectedRevision && currentRevision !== expectedRevision) throw new DescriptorConflictError(currentRevision ?? "missing");
  if (BUILTIN_IDS.has(id) && currentRevision == null) throw new DescriptorMutationError("Bundled descriptors are immutable references and cannot be disconnected.");
  if (currentRevision != null) {
    assertRegularTarget(file);
    fs.unlinkSync(file);
  }
  invalidateDescriptorCache();
  invalidateRegistry();
  return { removed: currentRevision != null, fallback: BUILTIN_IDS.has(id) ? "bundled-reference" : "user-managed" };
}

export function descriptorPreview(rawInput: unknown): { descriptor: NormalizedDescriptor; issues: DescriptorIssue[] } {
  const raw = typeof rawInput === "string" ? parseDescriptorText(rawInput) : rawInput;
  const validation = validateDescriptor(raw, "connection-center");
  if (!validation.descriptor) throw new DescriptorMutationError(formatIssues(validation.issues));
  return { descriptor: validation.descriptor, issues: validation.issues };
}

export function readinessForHarness(harness: DiscoveredHarness, registration: HarnessRegistration): ReadinessLayer[] {
  const registrationReady = registration.enabled;
  const binaryReady = harness.status === "available";
  const trace = harness.integration.liveTrace;
  const rootEvidence = trace?.roots.map((root) => probeTraceRoot(root, trace.maxDepth ?? 4)) ?? [];
  const presentRoots = rootEvidence.filter((root) => root.present).length;
  const candidateFiles = rootEvidence.reduce((total, root) => total + root.candidates, 0);
  const observationState: ReadinessState = !trace
    ? "unavailable"
    : presentRoots === 0
      ? "unavailable"
      : presentRoots < trace.roots.length
        ? "partial"
        : candidateFiles > 0
          ? "ready"
          : "unknown";
  return [
    {
      id: "registration",
      label: "Registration",
      state: registrationReady ? "ready" : "unavailable",
      summary: registrationReady ? "Descriptor is valid and enabled." : "Descriptor is disabled.",
      diagnostic: registrationReady ? provenanceDescription(registration.provenance) : "Reconnect or enable this descriptor to restore the managed registration.",
      action: registrationReady ? "Registered" : "Reconnect descriptor",
    },
    {
      id: "binary",
      label: "Binary metadata",
      state: binaryReady ? "ready" : "unavailable",
      summary: binaryReady ? "Version and help probes passed." : harness.status === "not_found" ? "Executable was not found." : "A safe metadata probe failed.",
      diagnostic: binaryReady ? "No model call was sent." : harness.detail ?? "Check the executable path and rerun the safe probe.",
      action: binaryReady ? "Verified" : "Probe again",
    },
    {
      id: "execution",
      label: "Execution readiness",
      state: binaryReady ? "ready" : "unknown",
      summary: binaryReady ? "CLI can be selected for a run." : "Execution cannot be confirmed yet.",
      diagnostic: binaryReady ? "Provider or account readiness remains unknown until a real run supplies evidence." : "Resolve binary metadata before selecting this harness for a run.",
      action: binaryReady ? "Selectable" : "Resolve binary",
    },
    {
      id: "observation",
      label: "Observation readiness",
      state: observationState,
      summary: !trace ? "No liveTrace source is declared." : presentRoots === 0 ? "Declared roots are not present." : candidateFiles > 0 ? `${candidateFiles} candidate file${candidateFiles === 1 ? "" : "s"} discoverable.` : "Trace roots are present; no candidate files found yet.",
      diagnostic: !trace
        ? "This harness may still run, but Collection cannot discover archived sessions through this descriptor."
        : presentRoots < (trace?.roots.length ?? 0)
          ? `${presentRoots}/${trace?.roots.length ?? 0} declared trace roots are present.`
          : "Candidate files and parser coverage are measured separately from detect-only inventory; discovery is not runtime proof that every file is parseable evidence.",
      action: !trace ? "Add liveTrace" : presentRoots > 0 ? "Scan observation" : "Create or restore trace root",
    },
    {
      id: "judge",
      label: "Judge readiness",
      state: binaryReady && registrationReady ? "ready" : "unknown",
      summary: binaryReady && registrationReady ? "Eligible for an explicit judge selection." : "Judge eligibility is not confirmed.",
      diagnostic: binaryReady && registrationReady ? "A selected judge source/model still produces its own provider-backed receipt." : "Registration and execution readiness must be restored first.",
      action: binaryReady && registrationReady ? "Eligible" : "Resolve prerequisites",
    },
  ];
}

function probeTraceRoot(root: string, maxDepth: number): { present: boolean; candidates: number } {
  const expanded = root === "~" ? os.homedir() : root.startsWith("~/") ? path.join(os.homedir(), root.slice(2)) : root;
  try {
    if (!fs.statSync(expanded).isDirectory()) return { present: false, candidates: 0 };
  } catch {
    return { present: false, candidates: 0 };
  }
  const budget = { entries: 512, candidates: 0 };
  function walk(dir: string, depth: number): void {
    if (depth > maxDepth || budget.entries <= 0 || budget.candidates >= 32) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (budget.entries-- <= 0 || budget.candidates >= 32) return;
      const full = path.join(dir, entry.name);
      if (entry.isFile() && (/\.jsonl?$/i.test(entry.name) || entry.name.endsWith(".ndjson"))) {
        budget.candidates++;
      } else if (entry.isDirectory()) {
        walk(full, depth + 1);
      }
    }
  }
  walk(expanded, 0);
  return { present: true, candidates: budget.candidates };
}

function provenanceDescription(provenance: RegistrationProvenance): string {
  return provenance === "user-managed" ? "Persisted as a user-managed descriptor." : provenance === "user-override" ? "A user descriptor overrides the bundled reference with the same id." : "Bundled reference; it cannot be deleted from the connection center.";
}

function parseDescriptorText(input: string): unknown {
  try { return JSON.parse(input); } catch (error) { throw new DescriptorMutationError(`Descriptor JSON is invalid: ${error instanceof Error ? error.message : String(error)}`); }
}

function formatIssues(issues: DescriptorIssue[]): string {
  return issues.length ? issues.map((issue) => `${issue.source}: ${issue.message}`).join("; ") : "Descriptor is invalid.";
}
