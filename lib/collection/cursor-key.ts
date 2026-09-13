import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config';

/** Atomic publication prevents separate server bundles reading a half-written key. */
export function loadCursorKey(directory = path.join(ROOT, 'data'), configured = process.env.OPENEVAL_TRANSCRIPT_CURSOR_SECRET): Buffer {
  if (configured !== undefined) {
    if (Buffer.byteLength(configured) < 32) throw new Error('OPENEVAL_TRANSCRIPT_CURSOR_SECRET must contain at least 32 bytes.');
    return crypto.createHash('sha256').update(configured).digest();
  }
  const target = path.join(directory, '.transcript-cursor-key');
  fs.mkdirSync(directory, { recursive: true });
  if (!fs.existsSync(target)) {
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
      try { fs.linkSync(temporary, target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    } finally { fs.rmSync(temporary, { force: true }); }
  }
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 32) throw new Error('Transcript cursor key is invalid; restore the original key or rotate it to invalidate old links.');
  return fs.readFileSync(target);
}
