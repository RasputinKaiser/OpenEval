/** Format support is separate from whether a particular file passed validation. */
const transcriptFormats = new Set(['claude-projects', 'codex-sessions', 'jsonl-dir', 'hermes-json', 'hermes-sqlite', 'agent-sqlite', 'kimi-wire', 'deepseek-jsonl', 'grok-markdown', 'ncode']);
const evidenceFormats = new Set(['claude-projects', 'codex-sessions', 'jsonl-dir', 'hermes-json', 'ncode']);
export function sourceCapabilities(format: string, parseable = true) {
  const readable = parseable && transcriptFormats.has(format);
  return {
    readable, searchable: readable, normalized: readable,
    judgeEvidence: parseable && evidenceFormats.has(format),
    note: !readable ? 'Inventory only; transcript content unavailable.'
      : format === 'grok-markdown' ? 'Readable exported text; usage and structured tool metrics unavailable.'
      : ['agent-sqlite', 'hermes-sqlite'].includes(format) ? 'Schema and size limits apply; attachment references may be unavailable.'
      : 'Bounded reader; malformed, truncated and unsupported records remain explicit.',
  };
}
