import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadCursorKey } from '../lib/collection/cursor-key';
import { encodeTranscriptCursor, decodeTranscriptCursor, type TranscriptCursorPayload } from '../lib/collection/transcript-cursor';
import { PARSER_VERSION } from '../lib/live-cache';

const payload: TranscriptCursorPayload = { v: 1, sourceId: 'fixture', sessionId: 'session', file: '/private/fixture-user/session.jsonl', project: '/private/fixture-project', format: 'jsonl-dir', parserVersion: PARSER_VERSION, descriptorHash: 'fixture', revision: { size: 12, mtimeMs: 1, fingerprint: 'a'.repeat(64) }, byteOffset: 0, state: { calls: [['call', { name: 'tool-private-name' }]], recordIndex: 0, semanticTurns: 0 } };
test('encrypted cursors conceal local metadata, authenticate content and retire signed-only links', () => {
  const cursor = encodeTranscriptCursor(payload);
  assert.match(cursor, /^v2\./);
  assert.deepEqual(decodeTranscriptCursor(cursor), payload);
  for (const part of cursor.split('.').slice(1)) assert.doesNotMatch(Buffer.from(part, 'base64url').toString('utf8'), /fixture-user|fixture-project|tool-private-name|private/);
  assert.notEqual(encodeTranscriptCursor(payload), cursor, 'random nonce for each issued reference');
  const parts = cursor.split('.'); parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  assert.equal(decodeTranscriptCursor(parts.join('.')), null);
  const oldBody = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', 'openeval-local-transcript-cursor-v1').update(oldBody).digest('base64url');
  assert.equal(decodeTranscriptCursor(`${oldBody}.${signature}`), null);
  assert.equal(decodeTranscriptCursor(encodeTranscriptCursor({ ...payload, parserVersion: PARSER_VERSION - 1 })), null);
  assert.equal(decodeTranscriptCursor('v2.' + 'x'.repeat(2_000_001)), null);
});
test('cursor key persists across processes, has private permissions, and fails closed on corruption', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-key-fixture-'));
  try {
    const key = loadCursorKey(dir);
    assert.deepEqual(loadCursorKey(dir), key);
    const child = spawnSync(process.execPath, ['--import', 'tsx', '-e', `const {loadCursorKey}=require('./lib/collection/cursor-key.ts');const crypto=require('node:crypto');process.stdout.write(crypto.createHash('sha256').update(loadCursorKey(process.argv[1])).digest('hex'));`, dir], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, crypto.createHash('sha256').update(key).digest('hex'));
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, '.transcript-cursor-key')).mode & 0o777, 0o600);
    fs.writeFileSync(path.join(dir, '.transcript-cursor-key'), 'broken');
    assert.throws(() => loadCursorKey(dir), /invalid/);
    assert.throws(() => loadCursorKey(dir, 'short'), /32 bytes/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
