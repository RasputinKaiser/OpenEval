import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
// Dependency-free scripts must remain runnable before npm ci.
import { runtimeProblem, parseSetupArgs, setupSteps } from '../scripts/setup.mjs';
import { parsePort } from '../scripts/open.mjs';

test('setup checks runtime and has explicit non-mutating and recoverable stages', () => {
  assert.equal(runtimeProblem('22.22.3'), null);
  for (const version of ['18.0.0', '20.20.0', '24.0.0', 'unknown']) assert.match(runtimeProblem(version) ?? "", /Node 22/);
  assert.deepEqual(setupSteps(parseSetupArgs([])), ['install', 'verify', 'build']);
  assert.deepEqual(setupSteps(parseSetupArgs(['--check'])), ['verify']);
  assert.deepEqual(setupSteps(parseSetupArgs(['--skip-install'])), ['verify', 'build']);
  assert.deepEqual(setupSteps(parseSetupArgs(['--no-build'])), ['install', 'verify']);
  assert.throws(() => parseSetupArgs(['--force']), /Unknown option/);
});
test('launcher validates explicit ports and rejects extra arguments', () => {
  assert.equal(parsePort([]), '3000');
  assert.equal(parsePort(['--port', '3177']), '3177');
  for (const value of ['0', '65536', '-1', 'abc', '3.5', '3000;echo']) assert.throws(() => parsePort(['--port', value]));
  assert.throws(() => parsePort(['--hostname', '0.0.0.0']));
});
test('setup help works using Node alone and unknown flags exit unsuccessfully', () => {
  const help = spawnSync(process.execPath, ['scripts/setup.mjs', '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /No API keys/);
  const bad = spawnSync(process.execPath, ['scripts/setup.mjs', '--unknown'], { encoding: 'utf8' });
  assert.equal(bad.status, 1); assert.match(bad.stderr, /Unknown option/);
});
