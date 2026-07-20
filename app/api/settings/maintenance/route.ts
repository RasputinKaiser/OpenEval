import { NextResponse } from "next/server";
import {
  checkDbIntegrity,
  getDbStats,
  vacuumDb,
  walCheckpointTruncate,
  type DbStats,
} from "@/lib/db";
import { redactSensitiveText } from "@/lib/redaction";

export const dynamic = "force-dynamic";

/**
 * Local-only DB maintenance. The Host middleware already gates mutating
 * methods, but it deliberately lets GETs through — this endpoint re-checks the
 * Host itself (same rules as middleware.ts) so even read-only DB internals
 * never leak to a non-local Host, and POST keeps defense in depth.
 */
function allowedHost(req: Request): boolean {
  const rawHost = req.headers.get("host") ?? (() => {
    try { return new URL(req.url).host; } catch { return null; }
  })();
  if (!rawHost) return false;
  let hostname = "";
  try { hostname = new URL(`http://${rawHost}`).hostname.toLowerCase(); } catch { return false; }
  const configured = (process.env.OPENEVAL_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return hostname === "localhost" || hostname.endsWith(".localhost")
    || hostname === "127.0.0.1" || hostname === "[::1]"
    || configured.includes(hostname);
}

function forbidden(): NextResponse {
  return NextResponse.json({ error: "host not allowed" }, { status: 403 });
}

/** Paths can embed the operator's username; redaction defaults ON. */
function redactStats(stats: DbStats) {
  return {
    ...stats,
    path: redactSensitiveText(stats.path),
    recovery: stats.recovery
      ? { ...stats.recovery, movedAsideTo: redactSensitiveText(stats.recovery.movedAsideTo) }
      : null,
  };
}

export async function GET(req: Request) {
  if (!allowedHost(req)) return forbidden();
  const stats = redactStats(getDbStats());
  return NextResponse.json({ db: stats }, { headers: { "Cache-Control": "private, no-store" } });
}

const ACTIONS = new Set(["integrity_check", "quick_check", "checkpoint", "vacuum"]);

export async function POST(req: Request) {
  if (!allowedHost(req)) return forbidden();
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = typeof body.action === "string" ? body.action : "";
  if (!ACTIONS.has(action)) {
    return NextResponse.json(
      { error: `Unknown action "${action}" — expected one of: ${[...ACTIONS].join(", ")}` },
      { status: 400 }
    );
  }

  if (action === "integrity_check" || action === "quick_check") {
    const result = checkDbIntegrity(action === "integrity_check");
    return NextResponse.json({ action, ok: result.ok, messages: result.messages, checkedAt: result.checkedAt });
  }

  if (action === "checkpoint") {
    const result = walCheckpointTruncate();
    return NextResponse.json({ action, ok: true, result, db: redactStats(getDbStats()) });
  }

  // vacuum
  const before = getDbStats().sizeBytes;
  vacuumDb();
  const stats = getDbStats();
  return NextResponse.json({ action, ok: true, sizeBefore: before, sizeAfter: stats.sizeBytes, db: redactStats(stats) });
}
