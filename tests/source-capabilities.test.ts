import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sourceCapabilities } from '../lib/collection/source-capabilities';
import { collectEvidenceRecords } from '../lib/collection/evidence-records';

test('new native readers do not promise experimental judge-extractor support', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capability-fixture-'));
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, JSON.stringify({ type: 'user', message: { content: 'fixture text' } }));
  try {
    for (const format of ['kimi-wire', 'deepseek-jsonl', 'agent-sqlite', 'grok-markdown', 'hermes-sqlite']) {
      const capability = sourceCapabilities(format);
      assert.equal(capability.readable, true); assert.equal(capability.searchable, true);
      assert.equal(capability.judgeEvidence, false);
      const evidence = collectEvidenceRecords(file, { format, sourceId: 'fixture', sessionId: 'fixture' });
      assert.equal(evidence.unsupported, true);
    }
    assert.equal(sourceCapabilities('jsonl-dir').judgeEvidence, true);
    assert.equal(collectEvidenceRecords(file, { format: 'jsonl-dir', sourceId: 'fixture', sessionId: 'fixture' }).unsupported, false);
    assert.equal(sourceCapabilities('future-format').readable, false);
    assert.equal(sourceCapabilities('jsonl-dir', false).readable, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
