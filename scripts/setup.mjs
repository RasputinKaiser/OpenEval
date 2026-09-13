#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function runtimeProblem(version) {
  const major = Number(version.split('.')[0]);
  return major === 22 ? null : `Use Node 22 with npm 10. Active Node: ${version}. Install Node 22 from https://nodejs.org/en/download or run nvm install 22 && nvm use 22.`;
}
export function parseSetupArgs(args) {
  const allowed = new Set(['--check', '--skip-install', '--no-build', '--help']);
  for (const arg of args) if (!allowed.has(arg)) throw new Error(`Unknown option: ${arg}. Run npm run setup -- --help.`);
  return { check: args.includes('--check'), install: !args.includes('--skip-install'), build: !args.includes('--no-build'), help: args.includes('--help') };
}
export function setupSteps(options) {
  if (options.check) return ['verify'];
  return [...(options.install ? ['install'] : []), 'verify', ...(options.build ? ['build'] : [])];
}
export function runNpm(args, cwd = root) {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(command, npmCli ? [npmCli, ...args] : args, {
    cwd, stdio: 'inherit', shell: !npmCli && process.platform === 'win32',
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
  if (result.error || result.status !== 0) throw new Error(`${args.join(' ')} failed${result.status === null ? '' : ` (exit ${result.status})`}. ${result.error?.message ?? 'See the output above; resolve that step and rerun setup.'}`);
}
export function verifyDependencies(cwd = root) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    'import Database from "better-sqlite3"; import "next/package.json" with { type: "json" }; const db = new Database(":memory:"); db.prepare("select 1").get(); db.close();'],
  { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Dependencies or the SQLite native binding are unavailable. Run npm run setup (without --skip-install). If native compilation fails, install your platform build tools; see docs/getting-started.md.\n' + (result.stderr ?? '').slice(0, 1400));
}
export function main(args = process.argv.slice(2)) {
  const options = parseSetupArgs(args);
  if (options.help) {
    console.log('OpenEval setup\n  npm run setup                  Install locked dependencies, verify SQLite, build dashboard\n  npm run setup -- --check        Check runtime and installed dependencies without writes\n  npm run setup -- --skip-install Verify existing dependencies and rebuild\n  npm run setup -- --no-build     Install and verify for development\n\nNo API keys or agent accounts are required to inspect existing transcripts.');
    return;
  }
  const problem = runtimeProblem(process.versions.node);
  if (problem) throw new Error(problem);
  const npmVersion = process.env.npm_config_user_agent?.match(/npm\/(\d+)/)?.[1];
  if (npmVersion && npmVersion !== '10') throw new Error('Use npm 10 for the locked install (npm install -g npm@10), then rerun setup.');
  for (const step of setupSteps(options)) {
    console.log(`\nOpenEval setup · ${step}`);
    if (step === 'install') runNpm(['ci', '--include=dev']);
    if (step === 'verify') verifyDependencies();
    if (step === 'build') runNpm(['run', 'build']);
  }
  console.log(options.check ? '\nRuntime and SQLite checks passed.' : options.build
    ? '\nReady. Run npm run open, then visit http://127.0.0.1:3000.\nOpen Collection to discover local transcripts. No API key is needed.\nUse Ctrl+C to stop. Your data stays in data/ (or OPENEVAL_DATA_ROOT).'
    : '\nDependencies are ready. Run npm run dev for development, or npm run setup -- --skip-install to prepare production.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`\nSetup stopped: ${error.message}`); process.exitCode = 1; }
}
