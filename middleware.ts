import { NextResponse, type NextRequest } from "next/server";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function forbidden(reason: string): NextResponse {
  return NextResponse.json({ error: reason }, { status: 403 });
}

function allowedHost(rawHost: string | null): boolean {
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

export function middleware(req: NextRequest) {
  if (!MUTATING_METHODS.has(req.method)) return NextResponse.next();

  // Origin-relative checks alone are bypassable by DNS rebinding: after an
  // attacker hostname resolves to 127.0.0.1, the browser calls it same-origin.
  // Mutating requests therefore require an absolute local/configured Host too.
  if (!allowedHost(req.headers.get("host"))) return forbidden("host not allowed");

  // Browsers send Sec-Fetch-Site; trust it when present. "none" is direct
  // navigation (e.g. address bar), "same-origin" is our own UI.
  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite) {
    if (secFetchSite !== "same-origin" && secFetchSite !== "none") {
      return forbidden("cross-site request rejected");
    }
    return NextResponse.next();
  }

  // Fall back to Origin/Host comparison. Requests with neither header
  // (curl, server-side callers) pass.
  const origin = req.headers.get("origin");
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (!originHost || originHost !== req.headers.get("host")) {
      return forbidden("cross-origin request rejected");
    }
  }

  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
