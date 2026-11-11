import test, { type TestContext } from 'node:test';
import { type AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import * as setup from '../scripts/setup.mjs';
import * as launcher from '../scripts/open.mjs';

function checkout(t: TestContext) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'openeval-startup-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.mkdirSync(path.join(cwd, 'app'));
  fs.writeFileSync(path.join(cwd, 'package-lock.json'), 'lock v1');
  fs.writeFileSync(path.join(cwd, 'app/page.tsx'), 'page v1');
  return cwd;
}

test('install stamps track the lockfile and Node ABI, never local history', t => {
  const cwd = checkout(t);
  assert.equal(typeof setup.installIsCurrent, 'function');
  assert.equal(setup.installIsCurrent(cwd), false);
  setup.recordInstall(cwd);
  assert.equal(setup.installIsCurrent(cwd), true);
  fs.writeFileSync(path.join(cwd, 'package-lock.json'), 'lock v2');
  assert.equal(setup.installIsCurrent(cwd), false);
});

test('build stamps require complete output and rebuild for source edits, not data or docs', t => {
  const cwd = checkout(t);
  assert.equal(typeof setup.buildIsCurrent, 'function');
  assert.equal(setup.buildIsCurrent(cwd, '.next'), false);
  fs.mkdirSync(path.join(cwd, '.next'));
  for (const name of ['BUILD_ID', 'build-manifest.json', 'required-server-files.json']) fs.writeFileSync(path.join(cwd, '.next', name), '{}');
  setup.recordBuild(cwd, '.next');
  assert.equal(setup.buildIsCurrent(cwd, '.next'), true);
  fs.mkdirSync(path.join(cwd, 'data'));
  fs.writeFileSync(path.join(cwd, 'data/private.json'), 'local');
  fs.writeFileSync(path.join(cwd, 'README.md'), 'docs');
  assert.equal(setup.buildIsCurrent(cwd, '.next'), true);
  fs.writeFileSync(path.join(cwd, 'app/page.tsx'), 'page v2');
  assert.equal(setup.buildIsCurrent(cwd, '.next'), false);
  setup.recordBuild(cwd, '.next');
  fs.rmSync(path.join(cwd, '.next/required-server-files.json'));
  assert.equal(setup.buildIsCurrent(cwd, '.next'), false);
});

test('custom build directory uses its own stamp and corrupt stamps are recoverable', t => {
  const cwd = checkout(t);
  assert.equal(typeof setup.buildIsCurrent, 'function');
  fs.mkdirSync(path.join(cwd, 'custom'));
  for (const name of ['BUILD_ID', 'build-manifest.json', 'required-server-files.json']) fs.writeFileSync(path.join(cwd, 'custom', name), '{}');
  setup.recordBuild(cwd, 'custom');
  assert.equal(setup.buildIsCurrent(cwd, 'custom'), true);
  assert.equal(setup.buildIsCurrent(cwd, '.next'), false);
  fs.writeFileSync(path.join(cwd, 'custom/openeval-build.json'), '{');
  assert.equal(setup.buildIsCurrent(cwd, 'custom'), false);
});

test('occupied ports fail before preparation with a useful alternative', async t => {
  assert.equal(typeof launcher.checkPort, 'function');
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  t.after(() => server.close());
  const port = (server.address() as AddressInfo).port;
  await assert.rejects(launcher.checkPort(String(port)), /in use.*--port/s);
  await new Promise<void>(resolve => server.close(() => resolve()));
  await launcher.checkPort(String(port));
});

test('preparation lock prevents concurrent installers and is released', t => {
  const cwd = checkout(t);
  assert.equal(typeof setup.acquireSetupLock, 'function');
  const release = setup.acquireSetupLock(cwd);
  assert.throws(() => setup.acquireSetupLock(cwd), /already.*prepar/i);
  release();
  setup.acquireSetupLock(cwd)();
});

test('a development server rewriting build manifests invalidates production reuse', t => {
  const cwd = checkout(t);
  fs.mkdirSync(path.join(cwd, '.next'));
  for (const name of ['BUILD_ID', 'build-manifest.json', 'required-server-files.json']) fs.writeFileSync(path.join(cwd, '.next', name), '{}');
  setup.recordBuild(cwd, '.next');
  fs.writeFileSync(path.join(cwd, '.next/build-manifest.json'), '{"dev":true}');
  assert.equal(setup.buildIsCurrent(cwd, '.next'), false);
});

test('deleted source and public environment changes invalidate the build', t => {
  const cwd = checkout(t);
  fs.mkdirSync(path.join(cwd, '.next'));
  for (const name of ['BUILD_ID', 'build-manifest.json', 'required-server-files.json']) fs.writeFileSync(path.join(cwd, '.next', name), '{}');
  setup.recordBuild(cwd, '.next');
  fs.rmSync(path.join(cwd, 'app/page.tsx'));
  assert.equal(setup.buildIsCurrent(cwd, '.next'), false);
  setup.recordBuild(cwd, '.next');
  const before = process.env.NEXT_PUBLIC_STARTUP_TEST;
  t.after(() => { if (before === undefined) delete process.env.NEXT_PUBLIC_STARTUP_TEST; else process.env.NEXT_PUBLIC_STARTUP_TEST = before; });
  process.env.NEXT_PUBLIC_STARTUP_TEST = 'changed';
  assert.equal(setup.buildIsCurrent(cwd, '.next'), false);
});

test('dependency-free launcher help and invalid ports never begin installation', () => {
  const help = spawnSync(process.execPath, ['scripts/open.mjs', '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Installs\/builds when needed/);
  const bad = spawnSync(process.execPath, ['scripts/open.mjs', '--port', '0'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Port must/);
  assert.doesNotMatch(bad.stdout, /setup|Installing|Preparing/);
});

test('first preparation installs/builds, repeats reuse, and failures remain retryable', t => {
  const cwd = checkout(t);
  const fakeNpm = path.join(cwd, 'npm-fixture.cjs');
  fs.writeFileSync(fakeNpm, `
    const fs = require('node:fs');
    const path = require('node:path');
    const command = process.argv[2];
    fs.appendFileSync('commands.log', command + '\\n');
    if (process.env.FAIL_STEP === command) process.exit(7);
    if (command === 'ci') {
      fs.mkdirSync('node_modules/better-sqlite3', { recursive: true });
      fs.writeFileSync('node_modules/better-sqlite3/package.json', JSON.stringify({name:'better-sqlite3',main:'index.cjs'}));
      fs.writeFileSync('node_modules/better-sqlite3/index.cjs', 'module.exports = class { prepare() { return { get() { return 1; } }; } close() {} };');
      fs.mkdirSync('node_modules/next', { recursive: true });
      fs.writeFileSync('node_modules/next/package.json', JSON.stringify({name:'next'}));
    } else if (command === 'run') {
      fs.mkdirSync('.next', { recursive: true });
      for (const name of ['BUILD_ID', 'build-manifest.json', 'required-server-files.json']) fs.writeFileSync(path.join('.next', name), '{}');
    }
  `);
  const run = (failStep = '') => spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { prepareDashboard } from ${JSON.stringify(pathToFileURL(path.resolve('scripts/setup.mjs')).href)}; prepareDashboard(${JSON.stringify(cwd)});`], {
    cwd, encoding: 'utf8', env: { ...process.env, npm_execpath: fakeNpm, FAIL_STEP: failStep, OPENEVAL_BUILD_DIR: '.next' },
  });
  assert.equal(run('ci').status, 1, 'install failure must stop preparation');
  assert.equal(fs.existsSync(path.join(cwd, '.next/openeval-build.json')), false);
  assert.equal(run('run').status, 1, 'build failure must stop preparation');
  assert.equal(fs.existsSync(path.join(cwd, '.next/openeval-build.json')), false);
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const before = fs.readFileSync(path.join(cwd, 'commands.log'), 'utf8');
  assert.match(before, /ci\nci\nrun\nrun\n/);
  const installStamp = fs.readFileSync(path.join(cwd, 'node_modules/.openeval-install.json'), 'utf8');
  setup.runSetup(setup.parseSetupArgs(['--check']), cwd);
  assert.equal(fs.readFileSync(path.join(cwd, 'node_modules/.openeval-install.json'), 'utf8'), installStamp, '--check must never rewrite installation metadata');
  const repeat = run();
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.match(repeat.stdout, /Using the prepared dashboard/);
  assert.equal(fs.readFileSync(path.join(cwd, 'commands.log'), 'utf8'), before);
  fs.writeFileSync(path.join(cwd, 'node_modules/better-sqlite3/index.cjs'), 'throw new Error("broken native binding");');
  assert.equal(run().status, 0, 'broken SQLite installation must be repaired');
  assert.equal(fs.readFileSync(path.join(cwd, 'commands.log'), 'utf8'), before + 'ci\nrun\n');
});

test('middleware changes invalidate a prepared production build', t => {
  const cwd = checkout(t);
  fs.mkdirSync(path.join(cwd, '.next'));
  for (const name of ['BUILD_ID', 'build-manifest.json', 'required-server-files.json']) fs.writeFileSync(path.join(cwd, '.next', name), '{}');
  setup.recordBuild(cwd, '.next');
  fs.writeFileSync(path.join(cwd, 'middleware.ts'), 'export const middleware = () => {};');
  assert.equal(setup.buildIsCurrent(cwd, '.next'), false);
});

test('absolute custom build directories detect rewritten manifests', t => {
  const cwd = checkout(t);
  const buildDir = path.join(cwd, 'custom');
  fs.mkdirSync(buildDir);
  for (const name of ['BUILD_ID', 'build-manifest.json', 'required-server-files.json']) fs.writeFileSync(path.join(buildDir, name), '{}');
  setup.recordBuild(cwd, buildDir);
  assert.equal(setup.buildIsCurrent(cwd, buildDir), true);
  fs.writeFileSync(path.join(buildDir, 'build-manifest.json'), '{"dev":true}');
  assert.equal(setup.buildIsCurrent(cwd, buildDir), false);
});

test('a stale lock is preserved rather than unsafely reclaiming another launch lock', t => {
  const cwd = checkout(t);
  fs.writeFileSync(path.join(cwd, '.openeval-setup.lock'), '2147483647');
  assert.throws(() => setup.acquireSetupLock(cwd), /already.*prepar/i);
  assert.equal(fs.readFileSync(path.join(cwd, '.openeval-setup.lock'), 'utf8'), '2147483647');
});
