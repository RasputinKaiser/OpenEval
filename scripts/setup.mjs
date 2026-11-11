#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
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
// These stamps contain hashes, never transcript data or environment values.
function hashFiles(cwd, inputs) {
  const hash = createHash('sha256');
  const visit = name => {
    const file = path.resolve(cwd, name);
    if (!fs.existsSync(file)) return;
    const stat = fs.lstatSync(file);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(file).sort()) {
        if (!['node_modules', '.git', '.DS_Store'].includes(child)) visit(path.join(name, child));
      }
    } else if (stat.isSymbolicLink()) {
      hash.update(name).update('\0').update(fs.readlinkSync(file)).update('\0');
    } else if (stat.isFile()) {
      hash.update(name).update('\0').update(fs.readFileSync(file)).update('\0');
    }
  };
  for (const input of inputs) visit(input);
  return hash.digest('hex');
}
function installFingerprint(cwd) {
  return `${process.platform}/${process.arch}/${process.versions.modules}/${hashFiles(cwd, ['package.json', 'package-lock.json'])}`;
}
function buildFingerprint(cwd) {
  const hash = createHash('sha256');
  hash.update(installFingerprint(cwd));
  hash.update(hashFiles(cwd, ['app', 'components', 'lib', 'public', 'cases', 'fixtures', 'harnesses',
    'middleware.ts', 'middleware.js', 'instrumentation.ts', 'instrumentation.js',
    'next.config.js', 'tsconfig.json', 'tailwind.config.ts', 'postcss.config.js',
    '.env', '.env.local', '.env.production', '.env.production.local', 'node_modules/.openeval-install.json']));
  for (const key of Object.keys(process.env).filter(key => key.startsWith('NEXT_PUBLIC_')).sort()) hash.update(key).update('\0').update(process.env[key]).update('\0');
  return hash.digest('hex');
}
function readStamp(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
export function installIsCurrent(cwd = root) {
  return readStamp(path.join(cwd, 'node_modules/.openeval-install.json'))?.fingerprint === installFingerprint(cwd);
}
export function recordInstall(cwd = root) {
  fs.mkdirSync(path.join(cwd, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'node_modules/.openeval-install.json'), JSON.stringify({ fingerprint: installFingerprint(cwd), installedAt: new Date().toISOString() }));
}
const BUILD_MARKERS = ['BUILD_ID', 'build-manifest.json', 'required-server-files.json'];
function buildOutputFingerprint(cwd, buildDir) {
  return hashFiles(cwd, BUILD_MARKERS.map(name => path.join(buildDir, name)));
}
export function buildIsCurrent(cwd = root, buildDir = process.env.OPENEVAL_BUILD_DIR || '.next') {
  return BUILD_MARKERS.every(name => fs.existsSync(path.resolve(cwd, buildDir, name)))
    && readStamp(path.resolve(cwd, buildDir, 'openeval-build.json'))?.fingerprint === buildFingerprint(cwd)
    && readStamp(path.resolve(cwd, buildDir, 'openeval-build.json'))?.outputFingerprint === buildOutputFingerprint(cwd, buildDir);
}
export function recordBuild(cwd = root, buildDir = process.env.OPENEVAL_BUILD_DIR || '.next') {
  fs.writeFileSync(path.resolve(cwd, buildDir, 'openeval-build.json'), JSON.stringify({ fingerprint: buildFingerprint(cwd), outputFingerprint: buildOutputFingerprint(cwd, buildDir) }));
}
export function acquireSetupLock(cwd = root) {
  const file = path.join(cwd, '.openeval-setup.lock');
  try {
    const fd = fs.openSync(file, 'wx');
    fs.writeFileSync(fd, String(process.pid));
    fs.closeSync(fd);
    return () => fs.rmSync(file, { force: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // Reclaiming by PID has a check/delete race with another starter. Leave
    // interrupted locks for explicit recovery rather than risk two installers.
    throw new Error('OpenEval may already be preparing this checkout. Wait for that setup/open command to finish. If it was interrupted, remove .openeval-setup.lock only after confirming no setup is running.');
  }
}
export function checkRuntime() {
  const problem = runtimeProblem(process.versions.node);
  if (problem) throw new Error(problem);
  const npmVersion = process.env.npm_config_user_agent?.match(/npm\/(\d+)/)?.[1];
  if (npmVersion && npmVersion !== '10') throw new Error('Use npm 10 for the locked install (npm install -g npm@10), then rerun setup.');
}
export function runSetup(options, cwd = root) {
  for (const step of setupSteps(options)) {
    console.log(`\nOpenEval setup · ${step}`);
    if (step === 'install') runNpm(['ci', '--include=dev'], cwd);
    if (step === 'verify') {
      verifyDependencies(cwd);
      if (options.install && !options.check) recordInstall(cwd);
    }
    if (step === 'build') {
      const stamp = path.resolve(cwd, process.env.OPENEVAL_BUILD_DIR || '.next', 'openeval-build.json');
      fs.rmSync(stamp, { force: true });
      runNpm(['run', 'build'], cwd);
      recordBuild(cwd);
    }
  }
}
export function prepareDashboard(cwd = root) {
  let dependenciesReady = installIsCurrent(cwd);
  if (dependenciesReady) {
    try { verifyDependencies(cwd); } catch { dependenciesReady = false; }
  }
  if (!dependenciesReady) {
    console.log('First start or dependencies changed. Installing the locked dependencies; this may take several minutes.');
    runSetup({ install: true, build: false }, cwd);
  }
  if (!buildIsCurrent(cwd)) {
    console.log('Preparing the production dashboard. The first build can take several minutes.');
    runSetup({ install: false, build: true }, cwd);
  } else console.log('Using the prepared dashboard.');
}
export function main(args = process.argv.slice(2)) {
  const options = parseSetupArgs(args);
  if (options.help) {
    console.log('OpenEval setup\n  npm run setup                  Install locked dependencies, verify SQLite, build dashboard\n  npm run setup -- --check        Check runtime and installed dependencies without writes\n  npm run setup -- --skip-install Verify existing dependencies and rebuild\n  npm run setup -- --no-build     Install and verify for development\n\nFor automatic first-time preparation and launch, run npm run open.\nNo API keys or agent accounts are required to inspect existing transcripts.');
    return;
  }
  checkRuntime();
  const release = options.check ? () => {} : acquireSetupLock();
  try { runSetup(options); } finally { release(); }
  console.log(options.check ? '\nRuntime and SQLite checks passed.' : options.build
    ? '\nReady. Run npm run open, then visit http://127.0.0.1:3000.\nOpen Collection to discover local transcripts. No API key is needed.\nUse Ctrl+C to stop. Your data stays in data/ (or OPENEVAL_DATA_ROOT).'
    : '\nDependencies are ready. Run npm run dev for development, or npm run open to prepare and start production.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`\nSetup stopped: ${error.message}`); process.exitCode = 1; }
}
