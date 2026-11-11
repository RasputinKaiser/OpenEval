#!/usr/bin/env node
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { root, checkRuntime, acquireSetupLock, prepareDashboard } from './setup.mjs';

export function parsePort(args, fallback = '3000') {
  if (args.length && (args.length !== 2 || args[0] !== '--port')) throw new Error('Usage: npm run open -- [--port 3000]');
  const raw = args[1] ?? fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) throw new Error('Port must be an integer from 1 to 65535.');
  return String(Number(raw));
}
export function checkPort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', error => reject(new Error(error.code === 'EADDRINUSE'
      ? `Port ${port} is in use. Try npm run open -- --port ${Number(port) === 3177 ? 3178 : 3177}. No process was stopped.`
      : `Cannot listen on 127.0.0.1:${port}: ${error.message}`)));
    server.listen(Number(port), '127.0.0.1', () => server.close(resolve));
  });
}
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log('npm run open -- [--port 3000]\nInstalls/builds when needed, then starts the dashboard on 127.0.0.1. First start needs network access and can take several minutes.'); return; }
  const port = parsePort(args, process.env.PORT ?? '3000');
  checkRuntime();
  await checkPort(port);
  const release = acquireSetupLock();
  try { prepareDashboard(); } finally { release(); }
  console.log(`OpenEval · http://127.0.0.1:${port}\nCtrl+C stops the dashboard. An occupied port will be reported; no process is stopped automatically.`);
  const child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', port], { cwd: root, stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1); });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`OpenEval could not start: ${error.message}`); process.exitCode = 1; });
}
