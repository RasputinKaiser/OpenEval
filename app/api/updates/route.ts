import { NextResponse } from "next/server";
import packageInfo from "@/package.json";
import { readRelease } from "@/lib/releases";

const { version } = packageInfo;

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch("https://api.github.com/repos/RasputinKaiser/OpenEval/releases/latest", {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 300 },
    });
    if (!response.ok) throw new Error("Release service unavailable");
    return NextResponse.json(readRelease(await response.json(), version), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ installed: version, error: "Could not check GitHub releases. Try again later or open the release page." }, { status: 502 });
  }
}
