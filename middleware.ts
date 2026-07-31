import { NextResponse, type NextRequest } from "next/server";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function forbidden(reason: string): NextResponse {
  return NextResponse.json({ error: reason }, { status: 403 });
}

function normalizeHost(rawHost: string | null): string | null {
  if (!rawHost || /[\s/@?#]/.test(rawHost)) return null;
  try {
    const parsed = new URL(`http://${rawHost}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return parsed.host.toLowerCase();
  } catch {
    return null;
  }
}

function hostName(rawHost: string | null): string | null {
  const host = normalizeHost(rawHost);
  if (!host) return null;
  try { return new URL(`http://${host}`).hostname.toLowerCase(); } catch { return null; }
}

function allowedHost(rawHost: string | null): boolean {
  const hostname = hostName(rawHost);
  if (!hostname) return false;
  const configured = (process.env.OPENEVAL_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => hostName(host.trim()))
    .filter((host): host is string => Boolean(host));
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
  }

  // Validate Origin whenever it is present, even when Sec-Fetch-Site says
  // "none". The latter is a useful browser signal, but it is not proof that
  // an accompanying Origin belongs to this local app.
  const origin = req.headers.get("origin");
  if (origin) {
    let originHost: string | null = null;
    try {
      const parsed = new URL(origin);
      if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
        return forbidden("cross-origin request rejected");
      }
      originHost = normalizeHost(parsed.host);
    } catch {
      originHost = null;
    }
    if (!originHost || originHost !== normalizeHost(req.headers.get("host"))) {
      return forbidden("cross-origin request rejected");
    }
  }

  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
