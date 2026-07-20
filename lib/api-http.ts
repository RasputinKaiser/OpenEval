import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Shared API error envelope. Every non-2xx JSON response from the API uses
 * this shape so clients can rely on `error` (short, human-readable), with
 * optional `detail` (what exactly was wrong) and `hint` (how to fix the call).
 * `field` names the request field a validation error belongs to, so form
 * clients (e.g. the New Run wizard) can render the message inline next to
 * the offending control instead of as a bare toast.
 */
export interface ApiErrorEnvelope {
  error: string;
  detail?: string;
  hint?: string;
  field?: string;
}

export interface ApiErrorOptions {
  detail?: string;
  hint?: string;
  field?: string;
  headers?: Record<string, string>;
}

export function apiError(status: number, error: string, opts: ApiErrorOptions = {}): NextResponse {
  const body: ApiErrorEnvelope = { error };
  if (opts.detail) body.detail = opts.detail;
  if (opts.hint) body.hint = opts.hint;
  if (opts.field) body.field = opts.field;
  return NextResponse.json(body, { status, headers: opts.headers });
}

export function badRequest(error: string, opts?: ApiErrorOptions): NextResponse {
  return apiError(400, error, opts);
}

export function notFound(error: string, opts?: ApiErrorOptions): NextResponse {
  return apiError(404, error, opts);
}

export function conflict(error: string, opts?: ApiErrorOptions): NextResponse {
  return apiError(409, error, opts);
}

/** 500 for genuine faults only — never for malformed caller input. */
export function internalError(error: string, cause?: unknown): NextResponse {
  const detail = cause === undefined ? undefined : cause instanceof Error ? cause.message : String(cause);
  return apiError(500, error, { detail });
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

function zodDetail(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/**
 * Validate query params against a zod schema. Empty-string values are treated
 * as absent (matching the pre-envelope `searchParams.get(x) || undefined`
 * semantics), unknown params are ignored, and validation failures become a
 * 400 with the shared envelope — malformed query input must never 500.
 */
export function parseQuery<S extends z.ZodTypeAny>(
  request: { url: string },
  schema: S
): ParseResult<z.infer<S>> {
  const raw: Record<string, string> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    if (value !== "") raw[key] = value;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: badRequest("Invalid query parameters", {
        detail: zodDetail(parsed.error),
        hint: "Fix the listed query parameters and retry.",
      }),
    };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Validate a JSON request body against a zod schema. Non-JSON bodies and
 * schema failures both become a 400 with the shared envelope.
 */
export async function parseJsonBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S
): Promise<ParseResult<z.infer<S>>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: badRequest("Invalid JSON body", { hint: "Send a JSON object with content-type: application/json." }),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: badRequest("Invalid request body", {
        detail: zodDetail(parsed.error),
        hint: "Fix the listed fields and retry.",
      }),
    };
  }
  return { ok: true, data: parsed.data };
}

/** `?flag=1` style boolean: only "0"/"1" accepted, anything else is a 400. */
export const queryFlag = z
  .enum(["0", "1"])
  .optional()
  .transform((value) => value === "1");

/** Numeric query param ("10" → 10); non-numeric input is a 400. */
export const queryNumber = z.coerce.number().finite().optional();

export function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
