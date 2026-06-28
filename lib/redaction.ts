const USER_PATH_RE = /\/(Users|home)\/([^/\s]+)/g;

export function redactSensitiveText(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .replace(USER_PATH_RE, "/$1/[redacted]")
    .replace(/(-Users-)([^-\s/]+)(-)/g, "$1[redacted]$3")
    .replace(/(-home-)([^-\s/]+)(-)/g, "$1[redacted]$3");
}

export function compactDisplayPath(value: unknown, redact: boolean): string {
  const raw = String(value ?? "");
  if (!redact) return raw;
  const text = redact ? redactSensitiveText(raw) : raw;
  const homeMatch = text.match(/^\/Users\/(?:\[redacted\]|[^/]+)\/(.+)$/) || text.match(/^\/home\/(?:\[redacted\]|[^/]+)\/(.+)$/);
  if (homeMatch) return `~/${homeMatch[1]}`;
  return text;
}
