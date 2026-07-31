import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";

export const RENDER_EVIDENCE_CONTRACT = "openeval.render-evidence" as const;
export const RENDER_EVIDENCE_VERSION = 1 as const;

export const RenderEvidenceReceiptSchema = z
  .object({
    version: z.literal(RENDER_EVIDENCE_VERSION),
    artifact: z
      .object({
        path: z.string().min(1).max(1_000),
        kind: z.enum(["html", "svg"]),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    viewport: z
      .object({
        width: z.number().int().positive().max(10_000),
        height: z.number().int().positive().max(10_000),
        deviceScaleFactor: z.number().positive().max(8),
      })
      .strict(),
    runtime: z
      .object({
        loaded: z.boolean(),
        consoleErrors: z.array(z.string().max(500)).max(32),
        horizontalOverflow: z.boolean(),
        clientWidth: z.number().int().nonnegative().max(10_000_000),
        scrollWidth: z.number().int().nonnegative().max(10_000_000),
        selectors: z
          .array(
            z
              .object({
                selector: z.string().min(1).max(240),
                count: z.number().int().nonnegative().max(1_000_000),
                visible: z.boolean().optional(),
              })
              .strict(),
          )
          .max(64),
      })
      .strict(),
  })
  .strict();

export type RenderArtifactKind = "html" | "svg";
export type RenderEvidenceStatus = "pass" | "fail" | "blocked";
export type RenderEvidenceReceipt = z.infer<typeof RenderEvidenceReceiptSchema>;

export interface RenderEvidenceSelectorExpectation {
  selector: string;
  minCount?: number;
  visible?: boolean;
}

export interface RenderEvidenceExpectation {
  artifactPath: string;
  artifactKind?: RenderArtifactKind;
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
  };
  selectors?: RenderEvidenceSelectorExpectation[];
}

export interface RenderEvidenceCheck {
  id: string;
  passed: boolean;
  detail: string;
}

export interface RenderEvidenceResult {
  contract: typeof RENDER_EVIDENCE_CONTRACT;
  version: typeof RENDER_EVIDENCE_VERSION;
  status: RenderEvidenceStatus;
  artifact: {
    path: string;
    kind: RenderArtifactKind | "unknown";
    bytes: number | null;
    sha256: string | null;
  };
  expected: {
    viewport: {
      width: number;
      height: number;
      deviceScaleFactor: number;
    };
    selectors: RenderEvidenceSelectorExpectation[];
  };
  observed: {
    receipt: RenderEvidenceReceipt;
  } | null;
  checks: RenderEvidenceCheck[];
  claims: {
    browserCapture: "receipt_validated_not_attested";
    pixelQuality: "not_evaluated";
  };
}

export interface RenderEvidenceValidationInput {
  artifactText: string;
  receipt: unknown;
  expectation: RenderEvidenceExpectation;
}

function check(id: string, passed: boolean, detail: string): RenderEvidenceCheck {
  return { id, passed, detail };
}

function artifactKindForPath(filePath: string): RenderArtifactKind | null {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html" || extension === ".htm") return "html";
  if (extension === ".svg") return "svg";
  return null;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function isSelfContainedReference(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("#") || normalized.startsWith("data:");
}

/**
 * This is intentionally a conservative source check, not an HTML renderer.
 * The browser adapter owns runtime capture; this gate makes sure the artifact
 * it captured is a single local HTML/SVG document rather than a page that
 * quietly depends on another file or a network service.
 */
function staticSourceIssues(source: string, kind: RenderArtifactKind | null): string[] {
  const issues: string[] = [];
  if (kind === null) issues.push("artifact extension must be .html, .htm, or .svg");
  if (kind === "html" && !/<html\b/i.test(source)) issues.push("HTML artifact has no <html> root");
  if (kind === "svg" && !/<svg\b/i.test(source)) issues.push("SVG artifact has no <svg> root");

  const referencePattern = /(?:^|[\s<])(src|href|poster|action|formaction|cite|srcset)\s*=\s*(["'])(.*?)\2/gi;
  const xlinkReferencePattern = /(?:^|[\s<])(xlink:href)\s*=\s*(["'])(.*?)\2/gi;
  for (const match of [...source.matchAll(referencePattern), ...source.matchAll(xlinkReferencePattern)]) {
    const attribute = match[1].toLowerCase();
    const rawValue = match[3].trim();
    const values = attribute === "srcset"
      ? rawValue.split(",").map((candidate) => candidate.trim().split(/\s+/)[0] ?? "")
      : [rawValue];
    if (values.some((value) => !isSelfContainedReference(value))) {
      issues.push(`${attribute} references an external or relative resource`);
    }
  }

  const cssUrlPattern = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
  for (const match of source.matchAll(cssUrlPattern)) {
    if (!isSelfContainedReference(match[2])) issues.push("CSS url() references an external or relative resource");
  }

  const forbiddenRuntimePatterns: Array<[RegExp, string]> = [
    [/@import\b/i, "@import is not self-contained"],
    [/\bfetch\s*\(/i, "fetch() is not allowed in static evidence"],
    [/\bXMLHttpRequest\b/i, "XMLHttpRequest is not allowed in static evidence"],
    [/\bWebSocket\s*\(/i, "WebSocket is not allowed in static evidence"],
    [/\bEventSource\s*\(/i, "EventSource is not allowed in static evidence"],
    [/navigator\.sendBeacon\s*\(/i, "sendBeacon is not allowed in static evidence"],
  ];
  for (const [pattern, detail] of forbiddenRuntimePatterns) {
    if (pattern.test(source)) issues.push(detail);
  }

  if (/<base\b/i.test(source)) issues.push("<base> is not allowed in static evidence");
  if (/<meta\b[^>]+http-equiv\s*=\s*(["'])?refresh\b/i.test(source)) {
    issues.push("meta refresh is not allowed in static evidence");
  }
  return [...new Set(issues)];
}

function makeResult(
  expectation: RenderEvidenceExpectation,
  artifact: RenderEvidenceResult["artifact"],
  status: RenderEvidenceStatus,
  checks: RenderEvidenceCheck[],
  receipt: RenderEvidenceReceipt | null,
): RenderEvidenceResult {
  return {
    contract: RENDER_EVIDENCE_CONTRACT,
    version: RENDER_EVIDENCE_VERSION,
    status,
    artifact,
    expected: {
      viewport: {
        width: expectation.viewport.width,
        height: expectation.viewport.height,
        deviceScaleFactor: expectation.viewport.deviceScaleFactor ?? 1,
      },
      selectors: expectation.selectors ?? [],
    },
    observed: receipt ? { receipt } : null,
    checks,
    claims: {
      browserCapture: "receipt_validated_not_attested",
      pixelQuality: "not_evaluated",
    },
  };
}

export function blockedRenderEvidence(
  expectation: RenderEvidenceExpectation,
  detail: string,
): RenderEvidenceResult {
  return makeResult(
    expectation,
    {
      path: expectation.artifactPath,
      kind: artifactKindForPath(expectation.artifactPath) ?? "unknown",
      bytes: null,
      sha256: null,
    },
    "blocked",
    [check("input", false, detail)],
    null,
  );
}

export function validateRenderEvidence(input: RenderEvidenceValidationInput): RenderEvidenceResult {
  const { artifactText, expectation } = input;
  const kind = artifactKindForPath(expectation.artifactPath);
  const digest = sha256(artifactText);
  const checks: RenderEvidenceCheck[] = [];
  const sourceIssues = kind === null ? ["artifact extension must be .html, .htm, or .svg"] : staticSourceIssues(artifactText, kind);
  const parsedReceipt = RenderEvidenceReceiptSchema.safeParse(input.receipt);
  const observedReceipt = parsedReceipt.success ? parsedReceipt.data : null;

  checks.push(
    check(
      "artifact_static",
      sourceIssues.length === 0,
      kind === null
        ? "artifact kind is unsupported"
        : sourceIssues.length === 0
          ? "single self-contained HTML/SVG source"
          : sourceIssues.join("; "),
    ),
  );
  checks.push(
    check(
      "artifact_identity",
      observedReceipt !== null &&
        observedReceipt.artifact.path === expectation.artifactPath &&
        observedReceipt.artifact.kind === kind &&
        observedReceipt.artifact.sha256 === digest,
      observedReceipt === null
        ? "receipt is unavailable"
        : observedReceipt.artifact.path !== expectation.artifactPath
          ? `receipt names ${observedReceipt.artifact.path}, expected ${expectation.artifactPath}`
          : observedReceipt.artifact.kind !== kind
            ? `receipt kind ${observedReceipt.artifact.kind} does not match ${kind ?? "unsupported"}`
            : observedReceipt.artifact.sha256 === digest
              ? "receipt SHA-256 matches the artifact"
              : "receipt SHA-256 does not match the artifact",
    ),
  );
  if (expectation.artifactKind) {
    checks.push(
      check(
        "artifact_kind",
        kind === expectation.artifactKind,
        `expected ${expectation.artifactKind}, observed ${kind ?? "unsupported"}`,
      ),
    );
  }

  if (!parsedReceipt.success) {
    const issues = parsedReceipt.error.issues
      .slice(0, 4)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    checks.push(check("receipt_schema", false, `receipt is not valid: ${issues}`));
    return makeResult(
      expectation,
      { path: expectation.artifactPath, kind: kind ?? "unknown", bytes: Buffer.byteLength(artifactText, "utf8"), sha256: digest },
      "blocked",
      checks,
      null,
    );
  }

  const receipt = parsedReceipt.data;
  checks.push(check("receipt_schema", true, "receipt matches the render-evidence schema"));
  checks.push(
    check(
      "viewport",
      receipt.viewport.width === expectation.viewport.width &&
        receipt.viewport.height === expectation.viewport.height &&
        receipt.viewport.deviceScaleFactor === (expectation.viewport.deviceScaleFactor ?? 1),
      `expected ${expectation.viewport.width}x${expectation.viewport.height}@${expectation.viewport.deviceScaleFactor ?? 1}, observed ${receipt.viewport.width}x${receipt.viewport.height}@${receipt.viewport.deviceScaleFactor}`,
    ),
  );
  checks.push(check("load", receipt.runtime.loaded, receipt.runtime.loaded ? "document load succeeded" : "document did not load"));
  checks.push(
    check(
      "console_errors",
      receipt.runtime.consoleErrors.length === 0,
      receipt.runtime.consoleErrors.length === 0
        ? "no console errors observed"
        : `${receipt.runtime.consoleErrors.length} console error(s) observed`,
    ),
  );
  const widthFactsAgree = receipt.runtime.horizontalOverflow === (receipt.runtime.scrollWidth > receipt.runtime.clientWidth);
  checks.push(
    check(
      "horizontal_overflow",
      !receipt.runtime.horizontalOverflow && widthFactsAgree,
      receipt.runtime.horizontalOverflow
        ? `horizontal overflow observed (clientWidth=${receipt.runtime.clientWidth}, scrollWidth=${receipt.runtime.scrollWidth})`
        : widthFactsAgree
          ? `no horizontal overflow (clientWidth=${receipt.runtime.clientWidth}, scrollWidth=${receipt.runtime.scrollWidth})`
          : "overflow flag disagrees with clientWidth/scrollWidth",
    ),
  );

  const seenSelectors = new Set<string>();
  for (const selectorResult of receipt.runtime.selectors) {
    if (seenSelectors.has(selectorResult.selector)) {
      checks.push(check("selector_duplicates", false, `receipt lists selector more than once: ${selectorResult.selector}`));
    }
    seenSelectors.add(selectorResult.selector);
  }
  for (const expected of expectation.selectors ?? []) {
    const observed = receipt.runtime.selectors.find((candidate) => candidate.selector === expected.selector);
    const minCount = expected.minCount ?? 1;
    const countPasses = observed !== undefined && observed.count >= minCount;
    const visibilityPasses = expected.visible === undefined || observed?.visible === expected.visible;
    checks.push(
      check(
        `selector:${expected.selector}`,
        countPasses && visibilityPasses,
        observed === undefined
          ? `selector not observed: ${expected.selector}`
          : !countPasses
            ? `${expected.selector} count=${observed.count}, expected at least ${minCount}`
            : !visibilityPasses
              ? `${expected.selector} visibility=${observed.visible ?? "unknown"}, expected ${expected.visible}`
              : `${expected.selector} count=${observed.count}${observed.visible === undefined ? "" : ` visible=${observed.visible}`}`,
      ),
    );
  }

  const passed = checks.every((current) => current.passed);
  return makeResult(
    expectation,
    { path: expectation.artifactPath, kind: kind ?? "unknown", bytes: Buffer.byteLength(artifactText, "utf8"), sha256: digest },
    passed ? "pass" : "fail",
    checks,
    receipt,
  );
}
