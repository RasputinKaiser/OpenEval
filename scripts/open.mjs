#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { root, runtimeProblem } from './setup.mjs';

export function parsePort(args, fallback = '3000') {
  if (args.length && (args.length !== 2 || args[0] !== '--port')) throw new Error('Usage: npm run open -- [--port 3000]');
  const raw = args[1] ?? fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) throw new Error('Port must be an integer from 1 to 65535.');
  return String(Number(raw));
}
export function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log('npm run open -- [--port 3000]\nStarts the production dashboard on 127.0.0.1. Run npm run setup first.'); return; }
  const problem = runtimeProblem(process.versions.node); if (problem) throw new Error(problem);
  const port = parsePort(args, process.env.PORT ?? '3000');
  const buildDir = process.env.OPENEVAL_BUILD_DIR || '.next';
  if (!fs.existsSync(path.resolve(root, buildDir, 'BUILD_ID'))) throw new Error('Production build missing. Run npm run setup first (or npm run setup -- --skip-install).');
  console.log(`OpenEval · http://127.0.0.1:${port}\nCtrl+C stops the dashboard. An occupied port will be reported; no process is stopped automatically.`);
  const child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', port], { cwd: root, stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1); });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
