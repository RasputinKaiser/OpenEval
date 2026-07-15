const HARNESS_COLORS: Record<string, string> = {
  "ncode": "#a78bff",
  "claude-code": "#d97757",
  "codex": "#10a37f",
  "hermes": "#4285f4",
};

export function harnessColor(id?: string): string {
  if (!id) return "#5a5a63";
  if (HARNESS_COLORS[id]) return HARNESS_COLORS[id];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360} 55% 65%)`;
}

export default function HarnessBadge({ harness, bin, version }: { harness?: string; bin?: string | null; version?: string | null }) {
  if (!harness) return null;
  const color = harnessColor(harness);
  return (
    <span
      className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider mono px-1.5 py-0.5 rounded shrink-0"
      style={{ color, backgroundColor: color + "20" }}
      title={bin ? `${bin}${version ? ` · ${version}` : ""}` : harness}
    >
      {harness}
      {version && <span className="normal-case tracking-normal opacity-70">v{version.split(" ")[0].slice(0, 12)}</span>}
    </span>
  );
}
